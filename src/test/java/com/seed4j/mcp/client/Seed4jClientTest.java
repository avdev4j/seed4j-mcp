package com.seed4j.mcp.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withBadRequest;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class Seed4jClientTest {

  private static final String BASE_URL = "http://test";

  private final ObjectMapper objectMapper = new ObjectMapper();
  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private Seed4jClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder();
    server = MockRestServiceServer.bindTo(builder).build();
    client = new Seed4jClient(BASE_URL, builder, objectMapper);
  }

  @Test
  void listModules_returnsRawBody() {
    server
      .expect(requestTo(BASE_URL + "/api/modules"))
      .andExpect(method(HttpMethod.GET))
      .andRespond(withSuccess("{\"categories\":[]}", MediaType.APPLICATION_JSON));

    assertThat(client.listModules()).isEqualTo("{\"categories\":[]}");
    server.verify();
  }

  @Test
  void getModuleDetails_includesSlugInPath() {
    server
      .expect(requestTo(BASE_URL + "/api/modules/maven-java"))
      .andExpect(method(HttpMethod.GET))
      .andRespond(withSuccess("{\"definitions\":[]}", MediaType.APPLICATION_JSON));

    assertThat(client.getModuleDetails("maven-java")).isEqualTo("{\"definitions\":[]}");
    server.verify();
  }

  @Test
  void listPresets_returnsRawBody() {
    server
      .expect(requestTo(BASE_URL + "/api/presets"))
      .andExpect(method(HttpMethod.GET))
      .andRespond(withSuccess("{\"presets\":[]}", MediaType.APPLICATION_JSON));

    assertThat(client.listPresets()).isEqualTo("{\"presets\":[]}");
    server.verify();
  }

  @Test
  void getProjectStatus_passesPathAsQueryParam() {
    server
      .expect(requestTo(BASE_URL + "/api/projects?path=/tmp/myapp"))
      .andExpect(method(HttpMethod.GET))
      .andRespond(withSuccess("{\"appliedModules\":[]}", MediaType.APPLICATION_JSON));

    assertThat(client.getProjectStatus("/tmp/myapp")).isEqualTo("{\"appliedModules\":[]}");
    server.verify();
  }

  @Test
  void searchModules_scoresAndOrdersMatches() throws Exception {
    String catalogue =
      """
      {"categories":[
        {"name":"Build","modules":[
          {"slug":"maven-java","description":"Maven build","tags":["build","java"]},
          {"slug":"gradle-java","description":"Gradle build","tags":["build","java"]}
        ]},
        {"name":"Persistence","modules":[
          {"slug":"jpa-postgresql","description":"JPA + PostgreSQL","tags":["database","sql"]}
        ]}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules"))
      .andRespond(withSuccess(catalogue, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.searchModules("maven", 0));
    assertThat(result.path("query").asText()).isEqualTo("maven");
    JsonNode matches = result.path("matches");
    assertThat(matches).hasSize(1);
    assertThat(matches.get(0).path("slug").asText()).isEqualTo("maven-java");
    assertThat(matches.get(0).path("score").asInt()).isPositive();
  }

  @Test
  void searchModules_respectsLimit() throws Exception {
    String catalogue =
      """
      {"categories":[
        {"name":"Build","modules":[
          {"slug":"maven-java","description":"build","tags":[]},
          {"slug":"maven-wrapper","description":"build","tags":[]},
          {"slug":"maven-extra","description":"build","tags":[]}
        ]}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules"))
      .andRespond(withSuccess(catalogue, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.searchModules("maven", 2));
    assertThat(result.path("matches")).hasSize(2);
  }

  @Test
  void searchModules_emptyQueryReturnsNoMatches() throws Exception {
    JsonNode result = objectMapper.readTree(client.searchModules("   ", 10));
    assertThat(result.path("matches")).isEmpty();
    server.verify();
  }

  @Test
  void getPresetDetails_matchesByNameCaseInsensitive() throws Exception {
    String presets =
      """
      {"presets":[
        {"name":"Java Library with Maven","modules":[{"slug":"init"},{"slug":"maven-java"}]},
        {"name":"Webapp","modules":[{"slug":"init"}]}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/presets"))
      .andRespond(withSuccess(presets, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.getPresetDetails("java library with maven"));
    assertThat(result.path("name").asText()).isEqualTo("Java Library with Maven");
    assertThat(result.path("modules")).hasSize(2);
  }

  @Test
  void getPresetDetails_throwsWhenMissing() {
    server
      .expect(requestTo(BASE_URL + "/api/presets"))
      .andRespond(withSuccess("{\"presets\":[]}", MediaType.APPLICATION_JSON));

    assertThatThrownBy(() -> client.getPresetDetails("Unknown"))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("Unknown");
  }

  @Test
  void getPresetDetails_rejectsBlankName() {
    assertThatThrownBy(() -> client.getPresetDetails("  ")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void validateProperties_flagsMissingMandatoryAndUnknownKeys() throws Exception {
    String schema =
      """
      {"definitions":[
        {"key":"packageName","mandatory":true,"type":"STRING"},
        {"key":"indentSize","mandatory":false,"type":"INTEGER"}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules/init"))
      .andRespond(withSuccess(schema, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.validateProperties("init", Map.of("indentSize", 2, "extra", "x")));

    assertThat(result.path("valid").asBoolean()).isFalse();
    JsonNode errors = result.path("errors");
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).path("key").asText()).isEqualTo("packageName");
    JsonNode warnings = result.path("warnings");
    assertThat(warnings).hasSize(1);
    assertThat(warnings.get(0).path("key").asText()).isEqualTo("extra");
  }

  @Test
  void validateProperties_flagsTypeMismatch() throws Exception {
    String schema =
      """
      {"definitions":[
        {"key":"indentSize","mandatory":true,"type":"INTEGER"},
        {"key":"verbose","mandatory":true,"type":"BOOLEAN"}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules/init"))
      .andRespond(withSuccess(schema, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(
      client.validateProperties("init", Map.of("indentSize", "not-a-number", "verbose", "yes"))
    );

    assertThat(result.path("valid").asBoolean()).isFalse();
    assertThat(result.path("errors")).hasSize(2);
  }

  @Test
  void validateProperties_acceptsValidPayload() throws Exception {
    String schema =
      """
      {"definitions":[
        {"key":"packageName","mandatory":true,"type":"STRING"},
        {"key":"indentSize","mandatory":false,"type":"INTEGER"}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules/init"))
      .andRespond(withSuccess(schema, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(
      client.validateProperties("init", Map.of("packageName", "com.example.app", "indentSize", 4))
    );

    assertThat(result.path("valid").asBoolean()).isTrue();
    assertThat(result.path("errors")).isEmpty();
    assertThat(result.path("warnings")).isEmpty();
  }

  @Test
  void validateProperties_acceptsIntegerStringForIntegerType() throws Exception {
    String schema = "{\"definitions\":[{\"key\":\"indentSize\",\"mandatory\":true,\"type\":\"INTEGER\"}]}";
    server
      .expect(requestTo(BASE_URL + "/api/modules/init"))
      .andRespond(withSuccess(schema, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.validateProperties("init", Map.of("indentSize", "4")));
    assertThat(result.path("valid").asBoolean()).isTrue();
  }

  @Test
  void applyModule_postsCorrectBody() throws Exception {
    String expectedBody = objectMapper.writeValueAsString(
      Map.of("projectFolder", "/tmp/app", "commit", false, "parameters", Map.of("packageName", "com.example.app"))
    );
    server
      .expect(requestTo(BASE_URL + "/api/modules/maven-java/apply-patch"))
      .andExpect(method(HttpMethod.POST))
      .andExpect(content().json(expectedBody))
      .andRespond(withSuccess("{\"status\":\"ok\"}", MediaType.APPLICATION_JSON));

    String result = client.applyModule("maven-java", "/tmp/app", Map.of("packageName", "com.example.app"));
    assertThat(result).isEqualTo("{\"status\":\"ok\"}");
    server.verify();
  }

  @Test
  void applyModules_appliesEverythingWhenAllSucceed() throws Exception {
    server
      .expect(requestTo(BASE_URL + "/api/modules/init/apply-patch"))
      .andRespond(withSuccess("{\"step\":1}", MediaType.APPLICATION_JSON));
    server
      .expect(requestTo(BASE_URL + "/api/modules/maven-java/apply-patch"))
      .andRespond(withSuccess("{\"step\":2}", MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(
      client.applyModules("/tmp/app", List.of(step("init", Map.of()), step("maven-java", Map.of())))
    );

    assertThat(result.path("appliedCount").asInt()).isEqualTo(2);
    assertThat(result.path("failure").isNull()).isTrue();
    assertThat(result.path("remaining")).isEmpty();
    assertThat(result.path("applied")).hasSize(2);
    server.verify();
  }

  @Test
  void applyModules_stopsAtFirstFailureAndListsRemaining() throws Exception {
    server
      .expect(requestTo(BASE_URL + "/api/modules/init/apply-patch"))
      .andRespond(withSuccess("{\"step\":1}", MediaType.APPLICATION_JSON));
    server.expect(requestTo(BASE_URL + "/api/modules/broken/apply-patch")).andRespond(withBadRequest().body("boom"));

    JsonNode result = objectMapper.readTree(
      client.applyModules(
        "/tmp/app",
        List.of(step("init", Map.of()), step("broken", Map.of()), step("never-tried", Map.of()))
      )
    );

    assertThat(result.path("appliedCount").asInt()).isEqualTo(1);
    assertThat(result.path("failure").path("slug").asText()).isEqualTo("broken");
    assertThat(result.path("failure").path("status").asInt()).isEqualTo(400);
    assertThat(result.path("failure").path("body").asText()).contains("boom");
    assertThat(result.path("remaining")).hasSize(1);
    assertThat(result.path("remaining").get(0).asText()).isEqualTo("never-tried");
    server.verify();
  }

  @Test
  void applyModules_rejectsEmptySteps() {
    assertThatThrownBy(() -> client.applyModules("/tmp/app", List.of())).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void applyPreset_resolvesPresetAndAppliesAllInOrder() throws Exception {
    String presets =
      """
      {"presets":[
        {"name":"Java Library with Maven","modules":[{"slug":"init"},{"slug":"maven-java"}]}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/presets"))
      .andRespond(withSuccess(presets, MediaType.APPLICATION_JSON));
    server
      .expect(requestTo(BASE_URL + "/api/modules/init/apply-patch"))
      .andRespond(withSuccess("{\"step\":1}", MediaType.APPLICATION_JSON));
    server
      .expect(requestTo(BASE_URL + "/api/modules/maven-java/apply-patch"))
      .andRespond(withSuccess("{\"step\":2}", MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(
      client.applyPreset("Java Library with Maven", "/tmp/app", Map.of("packageName", "com.example.app"))
    );

    assertThat(result.path("appliedCount").asInt()).isEqualTo(2);
    assertThat(result.path("failure").isNull()).isTrue();
    server.verify();
  }

  @Test
  void createProject_createsFolderThenAppliesInit(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("new-project");
    server
      .expect(requestTo(BASE_URL + "/api/modules/init/apply-patch"))
      .andRespond(withSuccess("{\"status\":\"ok\"}", MediaType.APPLICATION_JSON));

    client.createProject(target.toString(), Map.of("baseName", "myapp"));

    assertThat(Files.isDirectory(target)).isTrue();
    server.verify();
  }

  @Test
  void getModuleDependencies_returnsTopologicalOrderAndFeatureChoices() throws Exception {
    String landscape =
      """
      {"levels":[
        {"elements":[
          {"type":"MODULE","slug":"init","operation":"APPLY","rank":"RANK_S","dependencies":[]}
        ]},
        {"elements":[
          {"type":"FEATURE","slug":"build-tool","modules":[
            {"type":"MODULE","slug":"maven-java","operation":"APPLY","rank":"RANK_A","dependencies":[{"type":"MODULE","slug":"init"}]},
            {"type":"MODULE","slug":"gradle-java","operation":"APPLY","rank":"RANK_A","dependencies":[{"type":"MODULE","slug":"init"}]}
          ]}
        ]},
        {"elements":[
          {"type":"MODULE","slug":"java-base","operation":"APPLY","rank":"RANK_B","dependencies":[
            {"type":"MODULE","slug":"init"},
            {"type":"FEATURE","slug":"build-tool"}
          ]}
        ]}
      ]}
      """;
    server
      .expect(requestTo(BASE_URL + "/api/modules-landscape"))
      .andRespond(withSuccess(landscape, MediaType.APPLICATION_JSON));

    JsonNode result = objectMapper.readTree(client.getModuleDependencies("java-base"));

    assertThat(result.path("slug").asText()).isEqualTo("java-base");
    JsonNode order = result.path("applicationOrder");
    assertThat(order).hasSize(1);
    assertThat(order.get(0).asText()).isEqualTo("init");
    JsonNode choices = result.path("featureChoices");
    assertThat(choices.has("build-tool")).isTrue();
    assertThat(choices.path("build-tool")).hasSize(2);
  }

  @Test
  void getModuleDependencies_throwsWhenModuleAbsent() {
    server
      .expect(requestTo(BASE_URL + "/api/modules-landscape"))
      .andRespond(withSuccess("{\"levels\":[]}", MediaType.APPLICATION_JSON));

    assertThatThrownBy(() -> client.getModuleDependencies("missing"))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("missing");
  }

  private static Map<String, Object> step(String slug, Map<String, Object> properties) {
    Map<String, Object> step = new LinkedHashMap<>();
    step.put("slug", slug);
    step.put("properties", properties);
    return step;
  }
}
