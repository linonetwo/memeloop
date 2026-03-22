Feature: Terminal session cancellation via JSON-RPC
  In order to stop long-running terminal commands
  As a client using memeloop-node
  I want to cancel a running terminal session

  Scenario: Cancel a pre-started terminal session
    Given a running memeloop node "node-term-cancel"
    When I connect from "client-term-cancel" to "node-term-cancel" via WebSocket
    And a running terminal session with:
      | command | node |
      | args    | -e setInterval(function(){},1000) |
    When I cancel the terminal session on peer "node-term-cancel" from "client-term-cancel"
    Then the terminal session status should not be "running"

