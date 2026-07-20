import { OpenClawEnginePhase } from '../../shared/openclawEngine/constants';

/**
 * Reliable delivery of openclaw.json changes to a RUNNING gateway.
 *
 * Background: the hot-reload sync path used to write the config file and rely
 * entirely on the gateway's own file watcher to pick the change up. The watcher
 * can miss writes that land right after a gateway (re)start, leaving the
 * gateway validating against a stale in-memory config ("model not allowed"
 * on sessions.patch) until the next restart.
 *
 * This module pushes the already-written file content through the gateway's
 * `config.set` RPC instead. The gateway's reload evaluation diffs against its
 * LIVE (last-applied) config — not the file — so re-sending content that is
 * already on disk still hot-applies exactly what the live config is missing,
 * and is a harmless no-op when the watcher already caught up. The RPC response
 * is a positive ack: the reload evaluation completes before `ok` is returned.
 *
 * See specs/bugfixes/openclaw-config-hot-reload-delivery/.
 */

export const OpenClawConfigDeliveryMode = {
  /** Gateway acked config.set — the live config now matches the file. */
  Rpc: 'rpc',
  /** Gateway not running; the file on disk will be read at next start. */
  Skipped: 'skipped',
  /** RPC path failed; a deferred gateway restart guarantees convergence. */
  Fallback: 'fallback',
} as const;
export type OpenClawConfigDeliveryMode =
  typeof OpenClawConfigDeliveryMode[keyof typeof OpenClawConfigDeliveryMode];

export type OpenClawConfigRpcClient = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

export type OpenClawConfigDeliveryInput = {
  reason: string;
  gatewayPhase: OpenClawEnginePhase;
  /** Final on-disk config content (post enterprise merge). */
  readConfigFile: () => string;
  /**
   * Resolve a connected gateway RPC client, waiting for a starting gateway to
   * come up. Must resolve to null (not throw) when unavailable.
   */
  ensureRpcClient: () => Promise<OpenClawConfigRpcClient | null>;
  /** Schedule the existing workload-aware deferred gateway restart. */
  scheduleDeferredRestart: (reason: string) => void;
  nowMs?: () => number;
};

export type OpenClawConfigDeliveryResult = {
  mode: OpenClawConfigDeliveryMode;
  detail: string;
  restartScheduled: boolean;
  elapsedMs: number;
};

const CONFIG_GET_TIMEOUT_MS = 10_000;
const CONFIG_SET_TIMEOUT_MS = 15_000;
/** Rate limit for fallback-triggered auto restarts, guarding against loops. */
const FALLBACK_RESTART_MIN_INTERVAL_MS = 10 * 60 * 1000;

let lastFallbackRestartAtMs = 0;

export function __resetOpenClawConfigDeliveryStateForTests(): void {
  lastFallbackRestartAtMs = 0;
}

const isBaseHashConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /base hash|changed since last load/i.test(message);
};

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
};

async function requestConfigSet(
  client: OpenClawConfigRpcClient,
  raw: string,
): Promise<void> {
  const snapshot = await client.request<{ hash?: unknown }>(
    'config.get',
    {},
    { timeoutMs: CONFIG_GET_TIMEOUT_MS },
  );
  const baseHash = typeof snapshot?.hash === 'string' && snapshot.hash.trim()
    ? snapshot.hash.trim()
    : undefined;
  await client.request(
    'config.set',
    { raw, ...(baseHash ? { baseHash } : {}) },
    { timeoutMs: CONFIG_SET_TIMEOUT_MS },
  );
}

/**
 * Push the current config file content to a running gateway and return how the
 * delivery concluded. Never throws — every failure path degrades to the
 * deferred-restart fallback so convergence is still guaranteed.
 */
export async function deliverOpenClawConfigToGateway(
  input: OpenClawConfigDeliveryInput,
): Promise<OpenClawConfigDeliveryResult> {
  const now = input.nowMs ?? Date.now;
  const startedAtMs = now();
  const finish = (
    mode: OpenClawConfigDeliveryMode,
    detail: string,
    restartScheduled = false,
  ): OpenClawConfigDeliveryResult => {
    const result: OpenClawConfigDeliveryResult = {
      mode,
      detail,
      restartScheduled,
      elapsedMs: now() - startedAtMs,
    };
    const log = mode === OpenClawConfigDeliveryMode.Fallback ? console.warn : console.log;
    log(
      `[ConfigDelivery] mode=${result.mode} reason=${input.reason} detail=${result.detail}`
      + ` restartScheduled=${result.restartScheduled} elapsedMs=${result.elapsedMs}`,
    );
    return result;
  };

  const fallback = (detail: string): OpenClawConfigDeliveryResult => {
    const sinceLast = now() - lastFallbackRestartAtMs;
    if (sinceLast < FALLBACK_RESTART_MIN_INTERVAL_MS) {
      return finish(
        OpenClawConfigDeliveryMode.Fallback,
        `${detail}; restart rate-limited (${Math.round(sinceLast / 1000)}s since last)`,
        false,
      );
    }
    lastFallbackRestartAtMs = now();
    input.scheduleDeferredRestart(`config-delivery-fallback:${input.reason}`);
    return finish(OpenClawConfigDeliveryMode.Fallback, detail, true);
  };

  if (
    input.gatewayPhase !== OpenClawEnginePhase.Running
    && input.gatewayPhase !== OpenClawEnginePhase.Starting
  ) {
    return finish(
      OpenClawConfigDeliveryMode.Skipped,
      `gateway not running (phase=${input.gatewayPhase}); config loads at next start`,
    );
  }

  let raw: string;
  try {
    raw = input.readConfigFile();
  } catch (error) {
    return fallback(`config file read failed: ${describeError(error)}`);
  }
  if (!raw.trim()) {
    return fallback('config file is empty');
  }

  let client: OpenClawConfigRpcClient | null = null;
  try {
    client = await input.ensureRpcClient();
  } catch (error) {
    return fallback(`gateway client unavailable: ${describeError(error)}`);
  }
  if (!client) {
    return fallback('gateway client unavailable');
  }

  try {
    await requestConfigSet(client, raw);
    return finish(OpenClawConfigDeliveryMode.Rpc, 'config.set acked');
  } catch (error) {
    if (!isBaseHashConflict(error)) {
      return fallback(`config.set failed: ${describeError(error)}`);
    }
    // Another writer (e.g. the gateway itself) touched the file between our
    // hash read and the set. Re-read the hash once and retry.
    try {
      await requestConfigSet(client, raw);
      return finish(OpenClawConfigDeliveryMode.Rpc, 'config.set acked after hash retry');
    } catch (retryError) {
      return fallback(`config.set retry failed: ${describeError(retryError)}`);
    }
  }
}
