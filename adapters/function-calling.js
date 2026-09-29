import { AdapterInputError, CANONICAL_TOOL_NAMES, requireToolArguments } from "./mcp-client.js";

const MAX_ARGUMENT_BYTES = 1024 * 1024;

export function toFunctionTools(mcpTools) {
  if (!Array.isArray(mcpTools)) throw new AdapterInputError("invalid_tool_catalog");
  const seen = new Set();
  const tools = mcpTools.filter(tool => CANONICAL_TOOL_NAMES.includes(tool.name)).map(tool => {
    if (seen.has(tool.name)) throw new AdapterInputError("duplicate_tool_name");
    seen.add(tool.name);
    if (!tool.inputSchema || tool.inputSchema.type !== "object") {
      throw new AdapterInputError("invalid_server_input_schema");
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || tool.title || tool.name,
        parameters: structuredClone(tool.inputSchema)
      }
    };
  });
  if (CANONICAL_TOOL_NAMES.some(name => !seen.has(name))) {
    throw new AdapterInputError("incomplete_canonical_tool_catalog");
  }
  // DeepSeek strict-mode schema support has not been certified; do not enable it.
  return tools;
}

export function parseFunctionArguments(name, jsonArguments) {
  if (typeof jsonArguments !== "string" ||
      new TextEncoder().encode(jsonArguments).byteLength > MAX_ARGUMENT_BYTES) {
    throw new AdapterInputError("invalid_function_arguments");
  }
  let args;
  try { args = JSON.parse(jsonArguments); }
  catch { throw new AdapterInputError("malformed_function_arguments"); }
  requireToolArguments(name, args);
  return args;
}

export function createFunctionCallingAdapter(mcp) {
  if (!mcp || typeof mcp.listTools !== "function" || typeof mcp.callTool !== "function") {
    throw new AdapterInputError("mcp_client_required");
  }
  return {
    async tools(options) { return toFunctionTools(await mcp.listTools(options)); },
    async executeFunctionCall(name, jsonArguments, options) {
      return mcp.callTool(name, parseFunctionArguments(name, jsonArguments), options);
    },
    async executeDeepSeekToolCall(call, options) {
      if (!call || call.type !== "function" || typeof call.id !== "string" ||
          !call.id || call.id.length > 200 || !call.function) {
        throw new AdapterInputError("invalid_function_tool_call");
      }
      const args = parseFunctionArguments(call.function.name, call.function.arguments);
      const result = await mcp.callTool(call.function.name, args, options);
      // Preserve structuredContent, content, _meta, and isError; no verdict rewriting.
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) };
    }
  };
}
