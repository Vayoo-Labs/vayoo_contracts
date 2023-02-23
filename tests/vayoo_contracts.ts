import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert, expect } from "chai";
import { VayooContracts } from "../target/types/vayoo_contracts";
import { superUserKey, testUserKey } from "./testKeys";
import { toNativeAmount, toUiAmount } from "./utils";
import { GLOBAL_STATE_SEED, PYTH_FEED, UNDERLYING_MINT, USDC_MINT } from "./utils/constants";

const DEBUG_MODE = false; // If true, log useful info accross the tests on the console

describe("vayoo_contracts", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.VayooContracts as Program<VayooContracts>;
  const connection = program.provider.connection;
  const superUser = superUserKey.keypair;
  const testUser = testUserKey.keypair;
  const underlyingMint = new PublicKey(UNDERLYING_MINT.mint);
  const usdcMint = new PublicKey(USDC_MINT.mint);
  const pythFeed = new PublicKey(PYTH_FEED);

  let globalStateKey: PublicKey;
  let contractStateKey: PublicKey;
  let userStateKey: PublicKey;

  if (DEBUG_MODE) {
    console.log("Super User Key: ", superUser.publicKey.toString());
    console.log("Test User Key: ", testUser.publicKey.toString());
  }

  before(async () => {
    const txHash = await connection.requestAirdrop(superUser.publicKey, LAMPORTS_PER_SOL);
    await connection.requestAirdrop(testUser.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(txHash);
  })

  it("Create Global State", async () => {
    const [_globalStateKey, globalStateKeyBump] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_STATE_SEED)], program.programId)
    globalStateKey = _globalStateKey;

    try {
      await program.methods.createGlobalState(globalStateKeyBump).accounts({
        authority: superUser.publicKey,
        globalState: globalStateKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      }).signers([superUser]).rpc();
    } catch (err) {
      console.log(err);
    }
    const globalStateAccount = await program.account.globalState.fetch(globalStateKey);
    DEBUG_MODE ? console.log("Global State Key: ", globalStateKey.toString()) : null;
    assert.ok(globalStateAccount.totalTvlUsdc.toNumber() == 0);
  });

  it("Initialize Contract Account/State", async () => {
    const contractName = "v0";
    const [_contractStateKey, contractStateKeyBump] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), underlyingMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    contractStateKey = _contractStateKey;
    try {
      await program.methods.initializeContract(contractName, contractStateKeyBump).accounts({
        contractAuthority: superUser.publicKey,
        contractState: contractStateKey,
        underlyingMint: underlyingMint,
        pythFeed: pythFeed,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      }).signers([superUser]).rpc();
    } catch (err) {
      console.log(err);
    }
    const contractStateAccount = await program.account.contractState.fetch(contractStateKey);
    DEBUG_MODE ? console.log("Contract State Key: ", contractStateKey.toString()) : null;
    assert.ok(contractStateAccount.isHalted == false);
    assert.ok(contractStateAccount.pythFeedId.equals(pythFeed));
  });

  it("Initialize User State for test user", async () => {
    const [_userStateKey, userStateKeyBump] = anchor.web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    userStateKey = _userStateKey;
    try {
      await program.methods.initializeUser(userStateKeyBump).accounts({
        userAuthority: testUser.publicKey,
        userState: userStateKey,
        contractState: contractStateKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      }).signers([testUser]).rpc();
    } catch (err) {
      console.log(err);
    }
    const userStateAccount = await program.account.userState.fetch(userStateKey);
    DEBUG_MODE ? console.log("User State Key: ", userStateKey.toString()) : null;
    assert.ok(userStateAccount.usdcDeposited.toNumber() == 0);
  });

  it("Create ATAs for test user", async () => {
    const userUsdcAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const userUnderlyingAta = await getOrCreateAssociatedTokenAccount(connection, testUser, underlyingMint, testUser.publicKey, true);
    const userUsdcVaultAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, userStateKey, true);
    const userUnderlyingVaultAta = await getOrCreateAssociatedTokenAccount(connection, testUser, underlyingMint, userStateKey, true);

    if (DEBUG_MODE) {
      console.log("User USDC ATA : %s, bal: %d", userUsdcAta.address.toString(), toUiAmount(Number(userUsdcAta.amount), USDC_MINT.decimals));
      console.log("User Underlying ATA: %s, bal: %d", userUnderlyingAta.address.toString(), toUiAmount(Number(userUnderlyingAta.amount), UNDERLYING_MINT.decimals));
      console.log("User USDC Vault ATA : %s, bal: %d", userUsdcVaultAta.address.toString(), toUiAmount(Number(userUsdcVaultAta.amount), USDC_MINT.decimals));
      console.log("User Underlying Vault ATA : %s, bal: %d", userUnderlyingVaultAta.address.toString(), toUiAmount(Number(userUnderlyingVaultAta.amount), UNDERLYING_MINT.decimals));
    }
  });

  it("Deposit Collateral for test User", async () => {
    const userUsdcAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const userUsdcVaultAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, userStateKey, true);
    const amountToDeposit = new anchor.BN(toNativeAmount(0.01, USDC_MINT.decimals));
    
    if (DEBUG_MODE) {
      console.log("Before Deposit: User USDC ATA bal: %d", toUiAmount(Number(userUsdcAta.amount), USDC_MINT.decimals));
      console.log("Before Deposit: User USDC Vault ATA bal: %d", toUiAmount(Number(userUsdcVaultAta.amount), USDC_MINT.decimals));
    }

    try {
      await program.methods.depositCollateral(amountToDeposit).accounts({
        userAuthority: testUser.publicKey,
        userCollateralAta: userUsdcAta.address,
        vaultCollateralAta: userUsdcVaultAta.address,
        collateralMint: usdcMint,
        contractState: contractStateKey,
        userState: userStateKey,
        tokenProgram: TOKEN_PROGRAM_ID
      }).signers([testUser]).rpc();
    } catch (err) {
      console.log(err);
    }

    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const userUsdcVaultAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, userStateKey, true);

    if (DEBUG_MODE) {
      console.log("After Deposit: User USDC ATA bal: %d", toUiAmount(Number(userUsdcAtaAfter.amount), USDC_MINT.decimals));
      console.log("After Deposit: User USDC Vault ATA bal: %d", toUiAmount(Number(userUsdcVaultAtaAfter.amount), USDC_MINT.decimals));
    }

    const userStateAccount = await program.account.userState.fetch(userStateKey);
    assert.ok(userStateAccount.usdcDeposited.eq(amountToDeposit));
  });
});
