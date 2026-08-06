import process from "node:process";

import { loadDeploymentConfig } from "@the-town-remembers/runtime-config/deployment";

import { createApp } from "./app.js";

const { app } = createApp(loadDeploymentConfig(process.env), {
  outdir: "cdk.out",
});
app.synth();
