import { createServerFn } from "@tanstack/react-start";

/** Public, read-only: which on-chain features are genuinely usable in this build, and exactly why not. */
export const getDeploymentHealth = createServerFn({ method: "GET" })
  .inputValidator((input?: { force?: boolean }) => input ?? {})
  .handler(async ({ data }) => {
    const { verifyDeployment, verifyLiquidityInfra, ipfsPinningStatus } = await import("@/lib/launchpad.server");
    const [deployment, liquidity] = await Promise.all([
      verifyDeployment(data.force ? { force: true } : {}),
      verifyLiquidityInfra(),
    ]);
    return { deployment, liquidity, ipfs: ipfsPinningStatus() };
  });
