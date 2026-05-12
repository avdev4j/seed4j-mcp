package com.seed4j.mcp.config;

import com.seed4j.mcp.tools.Seed4jTools;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class McpServerConfiguration {

  @Bean
  ToolCallbackProvider seed4jToolCallbacks(Seed4jTools tools) {
    return MethodToolCallbackProvider.builder().toolObjects(tools).build();
  }
}
