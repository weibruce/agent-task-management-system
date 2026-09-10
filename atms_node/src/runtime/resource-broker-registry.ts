/**
 * Explicit Node-side capability registry for Runtime resource brokers.
 * No registration means no grant may be attested.
 * @version 0.1.0
 */

import {
  AtmsPluginPermission,
  stableStringify,
  type AtmsPluginEffectivePermissionGrantV1,
  type AtmsPluginPermission as AtmsPluginPermissionValue,
  type AtmsPluginToolBindingV1,
} from "atms-protocol";

export const ATMS_RUNTIME_BROKERED_PERMISSIONS = new Set<AtmsPluginPermissionValue>([
  AtmsPluginPermission.WORKSPACE_READ,
  AtmsPluginPermission.WORKSPACE_WRITE,
  AtmsPluginPermission.ARTIFACT_READ,
  AtmsPluginPermission.PLUGIN_DATA_READ,
  AtmsPluginPermission.PLUGIN_DATA_WRITE,
  AtmsPluginPermission.NETWORK_CONNECT,
  AtmsPluginPermission.SECRET_USE,
]);

export interface PluginRuntimeBrokerSessionV1 {
  broker_session_version: 1;
  broker_id: string;
  session_id: string;
  permission: AtmsPluginPermissionValue;
  /** Must be byte-for-byte equal to the Manager-authorized grant. */
  effective_grant: AtmsPluginEffectivePermissionGrantV1;
  transport: "node-mediated";
  network?: {
    name: string;
    internal: true;
    hosts: string[];
  };
}

export interface PluginRuntimeBrokerProvisioner {
  readonly permission: AtmsPluginPermissionValue;
  provision(input: {
    runtime_instance_id: string;
    binding: AtmsPluginToolBindingV1;
    effective_grant: AtmsPluginEffectivePermissionGrantV1;
  }): Promise<PluginRuntimeBrokerSessionV1>;
}

export class PluginRuntimeBrokerCapabilityRegistry {
  readonly #provisioners = new Map<AtmsPluginPermissionValue, PluginRuntimeBrokerProvisioner>();

  register(provisioner: PluginRuntimeBrokerProvisioner): void {
    if (!ATMS_RUNTIME_BROKERED_PERMISSIONS.has(provisioner.permission)) {
      throw new Error(`Permission is not broker-provisioned: ${provisioner.permission}`);
    }
    if (this.#provisioners.has(provisioner.permission)) {
      throw new Error(`Runtime broker is already registered: ${provisioner.permission}`);
    }
    this.#provisioners.set(provisioner.permission, provisioner);
  }

  async provision(input: {
    runtime_instance_id: string;
    binding: AtmsPluginToolBindingV1;
    effective_grant: AtmsPluginEffectivePermissionGrantV1;
  }): Promise<PluginRuntimeBrokerSessionV1> {
    const grant = input.effective_grant;
    const provisioner = this.#provisioners.get(grant.permission);
    if (!provisioner) {
      throw new Error(`Plugin Runtime grant has no configured Node broker: ${grant.permission}`);
    }
    const session = await provisioner.provision({
      runtime_instance_id: input.runtime_instance_id,
      binding: structuredClone(input.binding),
      effective_grant: structuredClone(grant),
    });
    if (!session || session.broker_session_version !== 1 || session.transport !== "node-mediated"
      || session.permission !== grant.permission
      || stableStringify(session.effective_grant) !== stableStringify(grant)
      || typeof session.broker_id !== "string" || !session.broker_id
      || typeof session.session_id !== "string" || !session.session_id) {
      throw new Error(`Plugin Runtime broker widened or changed grant scope: ${grant.permission}`);
    }
    if (grant.permission === AtmsPluginPermission.NETWORK_CONNECT) {
      if (!session.network || session.network.internal !== true
        || stableStringify(session.network.hosts) !== stableStringify(grant.hosts)
        || !/^atms-plugin-broker-[a-z0-9_.-]+$/.test(session.network.name)) {
        throw new Error("Plugin Runtime network broker did not preserve the exact host scope");
      }
    } else if (session.network !== undefined) {
      throw new Error(`Non-network Runtime broker cannot attach a network: ${grant.permission}`);
    }
    return structuredClone(session);
  }
}
