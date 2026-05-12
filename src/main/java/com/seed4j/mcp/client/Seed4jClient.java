package com.seed4j.mcp.client;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * HTTP client over the seed4j REST API. Endpoints follow the JHipster-Lite-style
 * surface that seed4j inherits; adjust paths here if the upstream API diverges.
 */
@Component
public class Seed4jClient {

  private final RestClient http;
  private final ObjectMapper objectMapper;

  public Seed4jClient(
    @Value("${seed4j.base-url}") String baseUrl,
    RestClient.Builder restClientBuilder,
    ObjectMapper objectMapper
  ) {
    this.http = restClientBuilder.baseUrl(baseUrl).build();
    this.objectMapper = objectMapper;
  }

  public String listModules() {
    return http.get().uri("/api/modules").retrieve().body(String.class);
  }

  public String getModuleDetails(String moduleSlug) {
    return http.get().uri("/api/modules/{slug}", moduleSlug).retrieve().body(String.class);
  }

  public String listPresets() {
    return http.get().uri("/api/presets").retrieve().body(String.class);
  }

  /**
   * Fetch a single preset by its display name (case-insensitive). Returns the preset object
   * (name + ordered module slugs) extracted from {@code /api/presets}. Throws
   * {@link IllegalArgumentException} when no preset matches.
   */
  public String getPresetDetails(String presetName) {
    if (presetName == null || presetName.isBlank()) {
      throw new IllegalArgumentException("Preset name is required");
    }
    JsonNode root;
    try {
      root = objectMapper.readTree(listPresets());
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to parse seed4j presets list", e);
    }
    String target = presetName.trim().toLowerCase();
    for (JsonNode preset : root.path("presets")) {
      if (preset.path("name").asText("").trim().toLowerCase().equals(target)) {
        try {
          return objectMapper.writeValueAsString(preset);
        } catch (JsonProcessingException e) {
          throw new IllegalStateException("Failed to serialize preset " + presetName, e);
        }
      }
    }
    throw new IllegalArgumentException("Preset not found: " + presetName);
  }

  /**
   * Validate a property map against a module's schema (the {@code definitions} returned by
   * {@code /api/modules/{slug}}). Pure local check — does not call seed4j to mutate anything.
   * Returns JSON: {@code {valid, errors:[{key,issue}], warnings:[{key,issue}]}}.
   */
  public String validateProperties(String moduleSlug, Map<String, Object> properties) {
    JsonNode schema;
    try {
      schema = objectMapper.readTree(getModuleDetails(moduleSlug));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to parse module schema for " + moduleSlug, e);
    }
    Map<String, Object> safeProperties = properties == null ? Map.of() : properties;
    List<Map<String, String>> errors = new ArrayList<>();
    List<Map<String, String>> warnings = new ArrayList<>();
    Set<String> knownKeys = new HashSet<>();

    for (JsonNode definition : schema.path("definitions")) {
      String key = definition.path("key").asText();
      knownKeys.add(key);
      String type = definition.path("type").asText("STRING");
      boolean mandatory = definition.path("mandatory").asBoolean(false);
      boolean present = safeProperties.containsKey(key);
      if (!present) {
        if (mandatory) {
          errors.add(issue(key, "missing mandatory property (type " + type + ")"));
        }
        continue;
      }
      Object value = safeProperties.get(key);
      String typeIssue = checkType(type, value);
      if (typeIssue != null) {
        errors.add(issue(key, typeIssue));
      }
    }

    for (String key : safeProperties.keySet()) {
      if (!knownKeys.contains(key)) {
        warnings.add(issue(key, "unknown property — not declared in module schema"));
      }
    }

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("slug", moduleSlug);
    result.put("valid", errors.isEmpty());
    result.put("errors", errors);
    result.put("warnings", warnings);
    try {
      return objectMapper.writeValueAsString(result);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize validation result for " + moduleSlug, e);
    }
  }

  private Map<String, String> issue(String key, String message) {
    Map<String, String> entry = new LinkedHashMap<>();
    entry.put("key", key);
    entry.put("issue", message);
    return entry;
  }

  private String checkType(String type, Object value) {
    if (value == null) {
      return "value is null";
    }
    return switch (type) {
      case "STRING" -> value instanceof String ? null : "expected STRING, got " + value.getClass().getSimpleName();
      case "INTEGER" -> isInteger(value) ? null : "expected INTEGER, got " + describeValue(value);
      case "BOOLEAN" -> value instanceof Boolean ? null : "expected BOOLEAN, got " + value.getClass().getSimpleName();
      default -> null;
    };
  }

  private boolean isInteger(Object value) {
    if (value instanceof Integer || value instanceof Long) {
      return true;
    }
    if (value instanceof String s) {
      try {
        Long.parseLong(s.trim());
        return true;
      } catch (NumberFormatException ignored) {
        return false;
      }
    }
    return false;
  }

  private String describeValue(Object value) {
    return value.getClass().getSimpleName() + " (" + value + ")";
  }

  /**
   * Apply an ordered list of modules to the same project folder, stopping at the first failure.
   * Each step is {@code {slug, properties}}. Returns a JSON summary describing what succeeded,
   * what failed (if anything), and what remained un-applied.
   */
  public String applyModules(String projectFolder, List<Map<String, Object>> steps) {
    if (steps == null || steps.isEmpty()) {
      throw new IllegalArgumentException("At least one module step is required");
    }
    List<Map<String, Object>> applied = new ArrayList<>();
    Map<String, Object> failure = null;
    List<String> remaining = new ArrayList<>();

    for (int i = 0; i < steps.size(); i++) {
      Map<String, Object> step = steps.get(i);
      String slug = String.valueOf(step.get("slug"));
      @SuppressWarnings("unchecked")
      Map<String, Object> props = step.get("properties") instanceof Map
        ? (Map<String, Object>) step.get("properties")
        : Map.of();
      if (failure != null) {
        remaining.add(slug);
        continue;
      }
      try {
        String response = applyModule(slug, projectFolder, props);
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("slug", slug);
        entry.put("response", response);
        applied.add(entry);
      } catch (RestClientResponseException e) {
        failure = describeFailure(slug, e.getStatusCode().value(), e.getResponseBodyAsString());
      } catch (RuntimeException e) {
        failure = describeFailure(slug, 0, e.getMessage());
      }
    }

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("projectFolder", projectFolder);
    result.put("appliedCount", applied.size());
    result.put("applied", applied);
    result.put("failure", failure);
    result.put("remaining", remaining);
    try {
      return objectMapper.writeValueAsString(result);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize batch apply result", e);
    }
  }

  private Map<String, Object> describeFailure(String slug, int status, String body) {
    Map<String, Object> failure = new LinkedHashMap<>();
    failure.put("slug", slug);
    failure.put("status", status);
    failure.put("body", body);
    return failure;
  }

  /**
   * Apply a preset (resolved by name) to the given project folder. The shared properties map
   * is passed to every module in the preset — presets are designed around a common set of
   * base inputs (project name, base name, package, etc.). Stops at the first failing module.
   */
  public String applyPreset(String presetName, String projectFolder, Map<String, Object> properties) {
    JsonNode preset;
    try {
      preset = objectMapper.readTree(getPresetDetails(presetName));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to parse preset " + presetName, e);
    }
    Map<String, Object> safeProperties = properties == null ? Map.of() : properties;
    List<Map<String, Object>> steps = new ArrayList<>();
    for (JsonNode module : preset.path("modules")) {
      String slug = module.path("slug").asText();
      if (slug.isBlank()) {
        continue;
      }
      Map<String, Object> step = new LinkedHashMap<>();
      step.put("slug", slug);
      step.put("properties", safeProperties);
      steps.add(step);
    }
    if (steps.isEmpty()) {
      throw new IllegalStateException("Preset has no modules: " + presetName);
    }
    return applyModules(projectFolder, steps);
  }

  public String getProjectStatus(String projectFolder) {
    return http
      .get()
      .uri(uri -> uri.path("/api/projects").queryParam("path", projectFolder).build())
      .accept(MediaType.APPLICATION_JSON)
      .retrieve()
      .body(String.class);
  }

  /**
   * Keyword/fuzzy search across all seed4j modules. Tokens from the query are matched
   * (case-insensitive substring) against slug, description, tags, and category name,
   * with weighted scoring (slug &gt; description &gt; tags/category).
   */
  public String searchModules(String query, int limit) {
    List<String> tokens = tokenize(query);
    if (tokens.isEmpty()) {
      return emptyMatches();
    }
    JsonNode root;
    try {
      root = objectMapper.readTree(http.get().uri("/api/modules").retrieve().body(String.class));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to parse seed4j modules list", e);
    }

    List<Map<String, Object>> matches = new ArrayList<>();
    for (JsonNode category : root.path("categories")) {
      String categoryName = category.path("name").asText("");
      String categoryLower = categoryName.toLowerCase();
      for (JsonNode module : category.path("modules")) {
        String slug = module.path("slug").asText("");
        String description = module.path("description").asText("");
        List<String> tags = new ArrayList<>();
        for (JsonNode tag : module.path("tags")) {
          tags.add(tag.asText(""));
        }
        int score = scoreModule(tokens, slug.toLowerCase(), description.toLowerCase(), tags, categoryLower);
        if (score > 0) {
          Map<String, Object> match = new LinkedHashMap<>();
          match.put("slug", slug);
          match.put("description", description);
          match.put("tags", tags);
          match.put("category", categoryName);
          match.put("score", score);
          matches.add(match);
        }
      }
    }

    matches.sort(Comparator.comparingInt((Map<String, Object> m) -> (int) m.get("score")).reversed());
    int effectiveLimit = limit > 0 ? limit : 20;
    if (matches.size() > effectiveLimit) {
      matches = matches.subList(0, effectiveLimit);
    }

    try {
      return objectMapper.writeValueAsString(Map.of("query", query, "matches", matches));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize search results", e);
    }
  }

  private int scoreModule(List<String> tokens, String slugLower, String descriptionLower, List<String> tags, String categoryLower) {
    int score = 0;
    for (String token : tokens) {
      if (slugLower.contains(token)) {
        score += 3;
      }
      if (descriptionLower.contains(token)) {
        score += 2;
      }
      for (String tag : tags) {
        if (tag.toLowerCase().contains(token)) {
          score += 1;
        }
      }
      if (categoryLower.contains(token)) {
        score += 1;
      }
    }
    return score;
  }

  private List<String> tokenize(String query) {
    if (query == null || query.isBlank()) {
      return List.of();
    }
    return Arrays.stream(query.toLowerCase().split("[^a-z0-9]+")).filter(s -> !s.isBlank()).toList();
  }

  private String emptyMatches() {
    try {
      return objectMapper.writeValueAsString(Map.of("query", "", "matches", List.of()));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize empty search result", e);
    }
  }

  public String applyModule(String moduleSlug, String projectFolder, Map<String, Object> properties) {
    Map<String, Object> body = Map.of(
      "projectFolder", projectFolder,
      "commit", false,
      "parameters", properties == null ? Map.of() : properties
    );
    return http.post().uri("/api/modules/{slug}/apply-patch", moduleSlug).body(body).retrieve().body(String.class);
  }

  public String createProject(String projectFolder, Map<String, Object> properties) {
    try {
      Files.createDirectories(Path.of(projectFolder));
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to create project folder: " + projectFolder, e);
    }
    return applyModule("init", projectFolder, properties);
  }

  /**
   * Walks the seed4j landscape graph to derive the application order for a module.
   * Returns a compact JSON view: the module's own metadata plus a topologically-ordered
   * list of MODULE prerequisites and any FEATURE alternatives the caller must choose from.
   */
  public String getModuleDependencies(String moduleSlug) {
    JsonNode landscape = fetchLandscape();
    Map<String, JsonNode> modulesBySlug = new HashMap<>();
    Map<String, List<String>> featureMembers = new LinkedHashMap<>();
    indexLandscape(landscape, modulesBySlug, featureMembers);

    JsonNode target = modulesBySlug.get(moduleSlug);
    if (target == null) {
      throw new IllegalArgumentException("Module not found in seed4j landscape: " + moduleSlug);
    }

    LinkedHashSet<String> applicationOrder = new LinkedHashSet<>();
    Map<String, List<String>> featureChoices = new LinkedHashMap<>();
    collectDependencies(target, modulesBySlug, featureMembers, applicationOrder, featureChoices, new HashSet<>());

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("slug", moduleSlug);
    result.put("operation", target.path("operation").asText());
    result.put("rank", target.path("rank").asText());
    result.put("directDependencies", objectMapper.convertValue(target.path("dependencies"), List.class));
    result.put("applicationOrder", new ArrayList<>(applicationOrder));
    result.put("featureChoices", featureChoices);
    try {
      return objectMapper.writeValueAsString(result);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize dependency view for " + moduleSlug, e);
    }
  }

  private JsonNode fetchLandscape() {
    String body = http.get().uri("/api/modules-landscape").retrieve().body(String.class);
    try {
      return objectMapper.readTree(body);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to parse seed4j landscape response", e);
    }
  }

  private void indexLandscape(
    JsonNode landscape,
    Map<String, JsonNode> modulesBySlug,
    Map<String, List<String>> featureMembers
  ) {
    for (JsonNode level : landscape.path("levels")) {
      for (JsonNode element : level.path("elements")) {
        String type = element.path("type").asText();
        if ("MODULE".equals(type)) {
          modulesBySlug.put(element.path("slug").asText(), element);
        } else if ("FEATURE".equals(type)) {
          List<String> members = new ArrayList<>();
          for (JsonNode member : element.path("modules")) {
            String memberSlug = member.path("slug").asText();
            modulesBySlug.put(memberSlug, member);
            members.add(memberSlug);
          }
          featureMembers.put(element.path("slug").asText(), members);
        }
      }
    }
  }

  private void collectDependencies(
    JsonNode module,
    Map<String, JsonNode> modulesBySlug,
    Map<String, List<String>> featureMembers,
    LinkedHashSet<String> applicationOrder,
    Map<String, List<String>> featureChoices,
    Set<String> visited
  ) {
    for (JsonNode dependency : module.path("dependencies")) {
      String type = dependency.path("type").asText();
      String slug = dependency.path("slug").asText();
      if ("MODULE".equals(type)) {
        if (!visited.add(slug)) {
          continue;
        }
        JsonNode dependencyModule = modulesBySlug.get(slug);
        if (dependencyModule != null) {
          collectDependencies(dependencyModule, modulesBySlug, featureMembers, applicationOrder, featureChoices, visited);
        }
        applicationOrder.add(slug);
      } else if ("FEATURE".equals(type)) {
        featureChoices.putIfAbsent(slug, featureMembers.getOrDefault(slug, List.of()));
      }
    }
  }
}
