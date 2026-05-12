package com.seed4j.mcp.tools;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.seed4j.mcp.client.Seed4jClient;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
public class Seed4jTools {

  private static final Logger log = LoggerFactory.getLogger(Seed4jTools.class);
  private static final TypeReference<Map<String, Object>> PROPERTIES_TYPE = new TypeReference<>() {};

  private final Seed4jClient client;
  private final ObjectMapper objectMapper;

  public Seed4jTools(Seed4jClient client, ObjectMapper objectMapper) {
    this.client = client;
    this.objectMapper = objectMapper;
  }

  @Tool(
    name = "list_modules",
    description = "List all available seed4j modules grouped by category. Returns JSON describing every module the seed4j server can apply."
  )
  public String listModules() {
    return client.listModules();
  }

  @Tool(
    name = "get_module_details",
    description = "Return the property definitions (mandatory/optional inputs, defaults, types) for a seed4j module. Use this to learn which parameters apply_module needs. For prerequisite ordering, call get_module_dependencies instead."
  )
  public String getModuleDetails(
    @ToolParam(description = "Slug identifier of the seed4j module (e.g. 'spring-boot', 'jpa-postgresql').") String moduleSlug
  ) {
    return client.getModuleDetails(moduleSlug);
  }

  @Tool(
    name = "get_module_dependencies",
    description = "Return the prerequisite graph for a seed4j module: an 'applicationOrder' list of module slugs to apply before this one (topologically ordered), the module's direct dependencies, and any 'featureChoices' the caller must pick from (e.g. choosing one datasource flavor). Use this before apply_module to assemble a coherent stack."
  )
  public String getModuleDependencies(
    @ToolParam(description = "Slug identifier of the target seed4j module.") String moduleSlug
  ) {
    return client.getModuleDependencies(moduleSlug);
  }

  @Tool(
    name = "list_presets",
    description = "List curated seed4j presets (named, pre-ordered stacks like 'Webapp: Vue + Spring Boot'). Each preset is a sequence of module slugs to apply in order. Prefer offering a matching preset when a user requests a common stack."
  )
  public String listPresets() {
    return client.listPresets();
  }

  @Tool(
    name = "search_modules",
    description = "Keyword search across all seed4j modules. Returns the highest-scoring matches by slug, description, tags, and category (case-insensitive substring scoring, slug weighted highest). Use this to narrow the catalogue before calling get_module_details or get_module_dependencies."
  )
  public String searchModules(
    @ToolParam(description = "Free-text query. Multiple terms are scored independently and summed.") String query,
    @ToolParam(description = "Maximum number of matches to return. Defaults to 20 if omitted or non-positive.", required = false) Integer limit
  ) {
    return client.searchModules(query, limit == null ? 0 : limit);
  }

  @Tool(
    name = "get_project_status",
    description = "Return the seed4j history of a project folder: the ordered list of applied module slugs and the aggregated properties used. Call this to discover what is already wired before suggesting next modules."
  )
  public String getProjectStatus(
    @ToolParam(description = "Absolute path to an existing seed4j project folder.") String projectFolder
  ) {
    return client.getProjectStatus(projectFolder);
  }

  @Tool(
    name = "apply_module",
    description = "Apply a seed4j module to an existing project folder. Use list_modules to discover slugs and get_module_details to learn which properties are required."
  )
  public String applyModule(
    @ToolParam(description = "Slug identifier of the seed4j module to apply.") String moduleSlug,
    @ToolParam(description = "Absolute path to the existing project folder to mutate.") String projectFolder,
    @ToolParam(
      description = "Module-specific properties as a JSON object string, e.g. '{\"packageName\":\"com.example.app\",\"baseName\":\"myapp\"}'. Pass '{}' when the module has no required properties.",
      required = false
    ) String propertiesJson
  ) {
    Map<String, Object> properties = parseProperties(propertiesJson);
    log.debug("apply_module slug={} folder={} properties={}", moduleSlug, projectFolder, properties);
    return client.applyModule(moduleSlug, projectFolder, properties);
  }

  @Tool(
    name = "create_project",
    description = "Initialise a new base seed4j project at the given folder. After this, use apply_module to add features (build tool, framework, persistence, etc.)."
  )
  public String createProject(
    @ToolParam(description = "Absolute path where the project will be created. The folder will be created if it does not exist.") String projectFolder,
    @ToolParam(
      description = "Base project properties as a JSON object string, e.g. '{\"projectName\":\"My App\",\"baseName\":\"myapp\",\"nodePackageManager\":\"npm\"}'."
    ) String propertiesJson
  ) {
    Map<String, Object> properties = parseProperties(propertiesJson);
    log.debug("create_project folder={} properties={}", projectFolder, properties);
    return client.createProject(projectFolder, properties);
  }

  private Map<String, Object> parseProperties(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    try {
      return objectMapper.readValue(json, PROPERTIES_TYPE);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("Invalid JSON for properties: " + json, e);
    }
  }
}
