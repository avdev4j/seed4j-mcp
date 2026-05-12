package com.seed4j.mcp.tools;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.seed4j.mcp.client.Seed4jClient;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class Seed4jToolsTest {

  @Mock
  private Seed4jClient client;

  @Captor
  private ArgumentCaptor<Map<String, Object>> propertiesCaptor;

  @Captor
  private ArgumentCaptor<List<Map<String, Object>>> stepsCaptor;

  private Seed4jTools tools;

  @BeforeEach
  void setUp() {
    tools = new Seed4jTools(client, new ObjectMapper());
  }

  @Test
  void listModules_delegatesToClient() {
    when(client.listModules()).thenReturn("{\"categories\":[]}");
    assertThat(tools.listModules()).isEqualTo("{\"categories\":[]}");
  }

  @Test
  void getModuleDetails_passesSlug() {
    when(client.getModuleDetails("maven-java")).thenReturn("{}");
    assertThat(tools.getModuleDetails("maven-java")).isEqualTo("{}");
  }

  @Test
  void getModuleDependencies_passesSlug() {
    when(client.getModuleDependencies("java-base")).thenReturn("{}");
    assertThat(tools.getModuleDependencies("java-base")).isEqualTo("{}");
  }

  @Test
  void listPresets_delegatesToClient() {
    when(client.listPresets()).thenReturn("{\"presets\":[]}");
    assertThat(tools.listPresets()).isEqualTo("{\"presets\":[]}");
  }

  @Test
  void getPresetDetails_passesName() {
    when(client.getPresetDetails("Java Library with Maven")).thenReturn("{}");
    assertThat(tools.getPresetDetails("Java Library with Maven")).isEqualTo("{}");
  }

  @Test
  void searchModules_passesZeroWhenLimitIsNull() {
    when(client.searchModules(eq("maven"), eq(0))).thenReturn("{}");
    assertThat(tools.searchModules("maven", null)).isEqualTo("{}");
  }

  @Test
  void searchModules_passesProvidedLimit() {
    when(client.searchModules(eq("maven"), eq(5))).thenReturn("{}");
    assertThat(tools.searchModules("maven", 5)).isEqualTo("{}");
  }

  @Test
  void getProjectStatus_passesFolder() {
    when(client.getProjectStatus("/tmp/app")).thenReturn("{}");
    assertThat(tools.getProjectStatus("/tmp/app")).isEqualTo("{}");
  }

  @Test
  void applyModule_parsesPropertiesJson() {
    when(client.applyModule(eq("maven-java"), eq("/tmp/app"), any())).thenReturn("{\"ok\":true}");

    String result = tools.applyModule("maven-java", "/tmp/app", "{\"packageName\":\"com.example.app\",\"indent\":2}");

    assertThat(result).isEqualTo("{\"ok\":true}");
    verify(client).applyModule(eq("maven-java"), eq("/tmp/app"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue())
      .containsEntry("packageName", "com.example.app")
      .containsEntry("indent", 2);
  }

  @Test
  void applyModule_treatsBlankPropertiesAsEmptyMap() {
    when(client.applyModule(eq("init"), eq("/tmp/app"), any())).thenReturn("{}");

    tools.applyModule("init", "/tmp/app", "  ");

    verify(client).applyModule(eq("init"), eq("/tmp/app"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).isEmpty();
  }

  @Test
  void applyModule_treatsNullPropertiesAsEmptyMap() {
    when(client.applyModule(eq("init"), eq("/tmp/app"), any())).thenReturn("{}");

    tools.applyModule("init", "/tmp/app", null);

    verify(client).applyModule(eq("init"), eq("/tmp/app"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).isEmpty();
  }

  @Test
  void applyModule_rejectsInvalidPropertiesJson() {
    assertThatThrownBy(() -> tools.applyModule("init", "/tmp/app", "not json"))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("Invalid JSON");
    verifyNoInteractions(client);
  }

  @Test
  void createProject_parsesPropertiesAndDelegates() {
    when(client.createProject(eq("/tmp/app"), any())).thenReturn("{\"ok\":true}");

    tools.createProject("/tmp/app", "{\"baseName\":\"myapp\"}");

    verify(client).createProject(eq("/tmp/app"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).containsEntry("baseName", "myapp");
  }

  @Test
  void validateProperties_parsesPropertiesAndDelegates() {
    when(client.validateProperties(eq("init"), any())).thenReturn("{\"valid\":true}");

    String result = tools.validateProperties("init", "{\"baseName\":\"myapp\"}");

    assertThat(result).isEqualTo("{\"valid\":true}");
    verify(client).validateProperties(eq("init"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).containsEntry("baseName", "myapp");
  }

  @Test
  void validateProperties_acceptsBlankPropertiesAsEmptyMap() {
    when(client.validateProperties(eq("init"), any())).thenReturn("{}");

    tools.validateProperties("init", "");

    verify(client).validateProperties(eq("init"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).isEmpty();
  }

  @Test
  void applyModules_parsesStepsArray() {
    when(client.applyModules(eq("/tmp/app"), any())).thenReturn("{\"appliedCount\":2}");

    String result = tools.applyModules(
      "/tmp/app",
      "[{\"slug\":\"init\",\"properties\":{\"baseName\":\"myapp\"}},{\"slug\":\"maven-java\",\"properties\":{}}]"
    );

    assertThat(result).isEqualTo("{\"appliedCount\":2}");
    verify(client).applyModules(eq("/tmp/app"), stepsCaptor.capture());
    List<Map<String, Object>> steps = stepsCaptor.getValue();
    assertThat(steps).hasSize(2);
    assertThat(steps.get(0)).containsEntry("slug", "init");
    assertThat(steps.get(1)).containsEntry("slug", "maven-java");
  }

  @Test
  void applyModules_rejectsBlankSteps() {
    assertThatThrownBy(() -> tools.applyModules("/tmp/app", "  "))
      .isInstanceOf(IllegalArgumentException.class);
    verifyNoInteractions(client);
  }

  @Test
  void applyModules_rejectsInvalidStepsJson() {
    assertThatThrownBy(() -> tools.applyModules("/tmp/app", "not json"))
      .isInstanceOf(IllegalArgumentException.class)
      .hasMessageContaining("Invalid JSON");
    verifyNoInteractions(client);
  }

  @Test
  void applyPreset_parsesSharedPropertiesAndDelegates() {
    when(client.applyPreset(eq("Java Library with Maven"), eq("/tmp/app"), any())).thenReturn("{}");

    tools.applyPreset("Java Library with Maven", "/tmp/app", "{\"packageName\":\"com.example.app\"}");

    verify(client).applyPreset(eq("Java Library with Maven"), eq("/tmp/app"), propertiesCaptor.capture());
    assertThat(propertiesCaptor.getValue()).containsEntry("packageName", "com.example.app");
  }

  @Test
  void searchModules_passesNegativeLimitThrough() {
    when(client.searchModules(anyString(), anyInt())).thenReturn("{}");
    tools.searchModules("maven", -1);
    verify(client).searchModules("maven", -1);
  }
}
