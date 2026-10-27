import { AccountRole, address, type Address, type Instruction } from '@solana/kit';

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');

/** System program Transfer (instruction index 2). */
export function transferSolIx(from: Address, to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export function computeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

export function computeUnitPriceIx(microLamports: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, microLamports, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

export function withoutComputeBudget(ixs: readonly Instruction[]): Instruction[] {
  return ixs.filter((ix) => ix.programAddress !== COMPUTE_BUDGET_PROGRAM);
}
