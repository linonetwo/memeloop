Feature: Cloud connectivity
  In order to be reachable across networks
  As a memeloop node
  I want to register via OTP, exchange nodeSecret for JWT, register my address, and heartbeat

  Scenario: OTP register -> JWT -> registerNode -> heartbeat
    Given a mock MemeLoop Cloud server
    When I register a node using otp "123456"
    And I exchange nodeSecret for a JWT
    And I register the node with port 12345 and name "test-node"
    Then the cloud heartbeat should succeed

