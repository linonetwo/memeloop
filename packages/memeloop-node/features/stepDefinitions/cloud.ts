import { Given, Then, When } from "@cucumber/cucumber";

import type { NodeWorld } from "./world.js";
import { CloudClient, buildRegistrationPayload } from "../../src/auth/cloudClient";
import { startMockCloud } from "../../src/testing/mockCloud";

Given("a mock MemeLoop Cloud server", async function (this: NodeWorld) {
  const started = await startMockCloud();
  this.mockCloud = { baseUrl: started.baseUrl, stop: started.stop };
});

When(
  "I register a node using otp {string}",
  async function (this: NodeWorld, otp: string) {
    if (!this.mockCloud) throw new Error("Mock cloud server not started");
    const client = new CloudClient(this.mockCloud.baseUrl);
    const { nodeId, nodeSecret } = await client.registerWithOtp(otp);
    this.cloudState = { nodeId, nodeSecret, jwt: "" };
  },
);

When("I exchange nodeSecret for a JWT", async function (this: NodeWorld) {
  if (!this.mockCloud) throw new Error("Mock cloud server not started");
  if (!this.cloudState) throw new Error("Cloud state not initialized");
  const client = new CloudClient(this.mockCloud.baseUrl);
  const jwt = (await client.getJwt(this.cloudState.nodeId, this.cloudState.nodeSecret)).accessToken;
  this.cloudState.jwt = jwt;
});

When(
  "I register the node with port {int} and name {string}",
  async function (this: NodeWorld, port: number, name: string) {
    if (!this.mockCloud) throw new Error("Mock cloud server not started");
    if (!this.cloudState?.jwt) throw new Error("JWT not available");
    const client = new CloudClient(this.mockCloud.baseUrl);
    const payload = buildRegistrationPayload(this.cloudState.nodeId, port, name, null);
    const res = await client.registerNode(payload, this.cloudState.jwt);
    if (!res.ok) throw new Error(`registerNode failed: ${JSON.stringify(res)}`);
  },
);

Then("the cloud heartbeat should succeed", async function (this: NodeWorld) {
  if (!this.mockCloud) throw new Error("Mock cloud server not started");
  if (!this.cloudState?.jwt) throw new Error("JWT not available");
  const client = new CloudClient(this.mockCloud.baseUrl);
  const res = await client.heartbeat(this.cloudState.nodeId, this.cloudState.jwt);
  if (!res.ok) throw new Error(`heartbeat failed: ${JSON.stringify(res)}`);
});

