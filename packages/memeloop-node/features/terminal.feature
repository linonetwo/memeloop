Feature: Terminal tools via JSON-RPC
  In order to manage long-running shell commands on a node
  As a client using memeloop-node
  I want to execute commands and inspect terminal sessions via RPC

  Scenario: Execute a simple command and list sessions
    Given a running memeloop node "node-term"
    When I connect from "client-term" to "node-term" via WebSocket
    And I call "memeloop.terminal.execute" on peer "node-term" from "client-term" with:
      | command   | echo hello-terminal |
      | timeoutMs | 5000               |
    Then the RPC result should have property "stdout" containing "hello-terminal"
    And calling "memeloop.terminal.list" on peer "node-term" from "client-term" should return at least 1 session

  Scenario: Terminal execute should time out
    Given a running memeloop node "node-term-timeout"
    When I connect from "client-term-timeout" to "node-term-timeout" via WebSocket
    And I call "memeloop.terminal.execute" on peer "node-term-timeout" from "client-term-timeout" with:
      | command   | node -e setInterval(function(){},1000) |
      | timeoutMs | 300                                 |
    Then the RPC result boolean property "timedOut" should be "true"

