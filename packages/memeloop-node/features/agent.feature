Feature: Agent RPC lifecycle on node
  In order to run agents on a node via JSON-RPC
  As a client connecting to a memeloop node
  I want to create an agent, send a message, and cancel it

  Scenario: Create agent and send message
    Given a mock OpenAI server replying with "hello from mock"
    And a running memeloop node "node-A" with provider "memeloop" pointing to the mock OpenAI server
    When I connect from "client-A" to "node-A" via WebSocket
    And I create an agent on "node-A" using definition "memeloop:general-assistant"
    And I send message "ping" to that agent on "node-A"
    Then the agent list on "node-A" should contain that conversation

  Scenario: Cancel an agent
    Given a mock OpenAI server replying with "hello from mock"
    And a running memeloop node "node-C" with provider "memeloop" pointing to the mock OpenAI server
    When I connect from "client-C" to "node-C" via WebSocket
    And I create an agent on "node-C" using definition "memeloop:general-assistant"
    When I cancel the agent on "node-C"
    Then the agent list on "node-C" should contain that conversation

  Scenario: OpenAI mock tool loop then final assistant message
    Given a mock OpenAI server with sequential replies:
      | content |
      | <tool_use name="e2eEcho">{"text":"cuke"}</tool_use> |
      | Final answer after tool. |
    And a running memeloop node "node-tool" with provider "memeloop" pointing to the mock OpenAI server
    And test tool "e2eEcho" is registered on node "node-tool"
    When I connect from "client-tool" to "node-tool" via WebSocket
    And I create an agent on "node-tool" using definition "memeloop:general-assistant"
    And I send message "use echo" to that agent on "node-tool"
    Then node "node-tool" should have persisted a tool message for that conversation
    And node "node-tool" should have assistant text containing "Final answer after tool" for that conversation

