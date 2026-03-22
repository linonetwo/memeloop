Feature: Tool capabilities reporting
  In order to let remote nodes see which tools are available
  As a client using memeloop-node
  I want node.getInfo to report tools from ToolRegistry

  Scenario: node.getInfo includes registered tool ids
    Given a running memeloop node "node-tools"
    When I connect from "client-tools" to "node-tools" via WebSocket
    And I call "memeloop.node.getInfo" on peer "node-tools" from "client-tools"
    Then the RPC result should have property "capabilities.tools" containing "terminal.execute"
    And the RPC result should have property "capabilities.tools" containing "file.read"

