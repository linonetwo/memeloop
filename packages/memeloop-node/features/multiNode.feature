Feature: Multi-node networking and discovery
  In order to coordinate work across multiple MemeLoop nodes
  As a user of memeloop-node
  I want nodes to discover each other and exchange basic RPC calls

  Scenario: Two nodes discover each other and respond to memeloop.node.getInfo
    Given a running memeloop node "node-A"
    And a running memeloop node "node-B"
    When I connect from "node-A" to "node-B" via WebSocket
    And I connect from "node-B" to "node-A" via WebSocket
    Then node "node-A" should see a peer with nodeId "node-B"
    And node "node-B" should see a peer with nodeId "node-A"
    And calling "memeloop.node.getInfo" on peer "node-B" from "node-A" should return nodeId "node-B"
    And calling "memeloop.node.getInfo" on peer "node-A" from "node-B" should return nodeId "node-A"

