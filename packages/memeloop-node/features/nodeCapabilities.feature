Feature: Node capability reporting
  In order to let other nodes understand what this node can do
  As a client using memeloop-node
  I want node.getInfo to expose wiki and MCP server capabilities

  Scenario: node.getInfo reports hasWiki and mcpServers
    Given a wiki base directory for tests
    And a running memeloop node "node-cap" with mcp servers:
      | name  | command |
      | mcp-1  | echo     |
    When I connect from "client-cap" to "node-cap" via WebSocket
    And I call "memeloop.node.getInfo" on peer "node-cap" from "client-cap"
    Then the RPC result should have property "nodeId" containing "node-cap"
    And the RPC result should have property "capabilities.hasWiki" containing "true"
    And the RPC result should have property "capabilities.mcpServers" containing "mcp-1"
    When I call "memeloop.mcp.listServers" on peer "node-cap" from "client-cap"
    Then the RPC result should include an MCP server named "mcp-1"

