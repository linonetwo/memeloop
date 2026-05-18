Feature: WebSocket LAN PIN authentication
  In order to protect a memeloop node on the LAN
  As an operator
  I want invalid handshakes to be rejected before any RPC runs

  Scenario: Wrong LAN PIN receives authentication failed
    Given strict LAN PIN "888888"
    And a running memeloop node "node-auth-wrong"
    When a raw WebSocket client connects to "node-auth-wrong"
    And the client sends auth handshake with PIN "000000"
    Then the client should receive JSON-RPC error code -32002

  Scenario: Multiple wrong PINs trigger exponential backoff
    Given strict LAN PIN "999999"
    And a clean auth state in config
    And a running memeloop node "node-auth-backoff"
    When a raw WebSocket client connects to "node-auth-backoff"
    And the client sends auth handshake with PIN "000000"
    And I wait for one JSON-RPC message on raw websocket
    And I clear LAN PIN cooldown in config for next attempt
    And a raw WebSocket client connects to "node-auth-backoff"
    And the client sends auth handshake with PIN "000000"
    And I wait for one JSON-RPC message on raw websocket
    Then the LAN PIN state in config should have failCount at least 2
    And the LAN PIN nextAllowedAt in config should be in the future

  Scenario: Clearing YAML cooldown enables immediate login
    Given strict LAN PIN "999999"
    And a clean auth state in config
    And a running memeloop node "node-auth-reset"
    When a raw WebSocket client connects to "node-auth-reset"
    And the client sends auth handshake with PIN "000000"
    And I wait for one JSON-RPC message on raw websocket
    And a clean auth state in config
    And a raw WebSocket client connects to "node-auth-reset"
    And the client sends auth handshake with PIN "999999"
    And I wait for one JSON-RPC message on raw websocket
    And the client sends JSON-RPC method "memeloop.node.getInfo" with id 2 and empty params
    Then the client should receive JSON-RPC result nodeId "node-auth-reset"

  Scenario: Non-handshake first message is rejected
    Given strict LAN PIN "888888"
    And a running memeloop node "node-auth-order"
    When a raw WebSocket client connects to "node-auth-order"
    And the client sends JSON-RPC method "memeloop.node.getInfo" with id 2 and empty params
    Then the client should receive JSON-RPC error code -32001

  Scenario: Correct LAN PIN allows subsequent RPC
    Given strict LAN PIN "888888"
    And a running memeloop node "node-auth-ok"
    And the client handshake credential is "888888"
    When I connect from "client-auth-ok" to "node-auth-ok" via WebSocket
    Then calling "memeloop.node.getInfo" on peer "node-auth-ok" from "client-auth-ok" should return nodeId "node-auth-ok"
