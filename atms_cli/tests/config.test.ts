import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../src/index.js";
import {
  configuredUiHttpPublicUrl,
  configuredUiPublicUrl,
  defaultLocalConfig,
  detectedMachineHost,
  getConfigPath,
  getSecretsPath,
  loadLocalConfig,
  loadLocalSecrets,
} from "../src/local-config.js";

let tempHome: string;
let previousHome: string | undefined;
let previousConfigPath: string | undefined;
let previousSecretsPath: string | undefined;
let previousApiKey: string | undefined;
let previousMimoKey: string | undefined;
let previousPublicHost: string | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "atms-cli-config-test-"));
  previousHome = process.env.ATMS_HOME;
  previousConfigPath = process.env.ATMS_CONFIG_PATH;
  previousSecretsPath = process.env.ATMS_SECRETS_PATH;
  previousApiKey = process.env.ATMS_API_KEY;
  previousMimoKey = process.env.ATMS_MIMO_API_KEY;
  previousPublicHost = process.env.ATMS_PUBLIC_HOST;
  process.env.ATMS_HOME = tempHome;
  delete process.env.ATMS_CONFIG_PATH;
  delete process.env.ATMS_SECRETS_PATH;
  delete process.env.ATMS_API_KEY;
  delete process.env.ATMS_MIMO_API_KEY;
  delete process.env.ATMS_PUBLIC_HOST;
});

afterEach(() => {
  restoreEnv("ATMS_HOME", previousHome);
  restoreEnv("ATMS_CONFIG_PATH", previousConfigPath);
  restoreEnv("ATMS_SECRETS_PATH", previousSecretsPath);
  restoreEnv("ATMS_API_KEY", previousApiKey);
  restoreEnv("ATMS_MIMO_API_KEY", previousMimoKey);
  restoreEnv("ATMS_PUBLIC_HOST", previousPublicHost);
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("config command", () => {
  it("keeps Docker capability implicit for the managed local Node", () => {
    expect(defaultLocalConfig().node).toEqual({
      projectId: "p1",
      nodeId: "local-docker-node",
      provider: "docker-cli",
    });

    fs.writeFileSync(getConfigPath(), JSON.stringify({
      node: {
        projectId: "legacy-project",
        nodeId: "legacy-node",
        provider: "docker-cli",
        capabilities: ["browser"],
      },
    }));

    expect(loadLocalConfig().node).toEqual({
      projectId: "legacy-project",
      nodeId: "legacy-node",
      provider: "docker-cli",
    });
  });

  it("routes regular config to config.json and secrets to the secrets file", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();

    await program.parseAsync(["node", "atms", "config", "set", "manager.url", "http://127.0.0.1:9910"]);
    await program.parseAsync(["node", "atms", "config", "set", "ui.port", "9911"]);
    await program.parseAsync(["node", "atms", "config", "set", "ATMS_MIMO_API_KEY", "secret-token"]);

    expect(getConfigPath()).toBe(path.join(tempHome, "config.json"));
    expect(getSecretsPath()).toBe(path.join(tempHome, "secrets", "env"));
    expect(loadLocalConfig().manager?.url).toBe("http://127.0.0.1:9910");
    expect(loadLocalConfig().manager?.port).toBe(9910);
    expect(loadLocalConfig().ui?.port).toBe(9911);
    expect(loadLocalSecrets().ATMS_MIMO_API_KEY).toBe("secret-token");
    expect(fs.readFileSync(getConfigPath(), "utf-8")).not.toContain("secret-token");

    await program.parseAsync(["node", "atms", "config", "show"]);
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("\"ATMS_MIMO_API_KEY\": \"set\"");
    expect(output).not.toContain("secret-token");
  });

  it("uses provider-specific local secret for catalog model configure without printing it", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "atms", "config", "set", "ATMS_TEST_PROVIDER_API_KEY", "local-secret"]);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            providers: [
              {
                id: "test-provider",
                endpoints: [
                  {
                    id: "test_endpoint",
                    base_url: "https://models.example.test/v1",
                    chat_completions_base_url: "https://models.example.test/v1",
                    default_model: "test-model",
                    models: [{ id: "test-model", recommended: true }],
                  },
                ],
              },
            ],
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        message: "Setting created",
        data: { id: "test-setting", api_key: "local-secret" },
      }),
    } as unknown as Response);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "atms", "model", "configure", "test-provider"]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:19191/api/llm/settings",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"api_key\":\"local-secret\""),
      }),
    );
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("test-provider/test-model");
    expect(output).not.toContain("local-secret");
  });
});

describe("local public URL helpers", () => {
  it("uses ATMS_PUBLIC_HOST for machine access host discovery", () => {
    process.env.ATMS_PUBLIC_HOST = "192.0.2.10";

    expect(detectedMachineHost()).toBe("192.0.2.10");
    expect(configuredUiPublicUrl(loadLocalConfig(), "0.0.0.0", 19192)).toBe("https://192.0.2.10:19192");
    expect(configuredUiHttpPublicUrl(loadLocalConfig(), "0.0.0.0", 19193)).toBe("http://192.0.2.10:19193");
  });

  it("keeps explicit Agent UI public URL as the override", () => {
    process.env.ATMS_PUBLIC_HOST = "192.0.2.10";

    expect(configuredUiPublicUrl(loadLocalConfig(), "0.0.0.0", 19192, "https://atms-ui.example.test")).toBe(
      "https://atms-ui.example.test",
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
