import * as anchor from "@project-serum/anchor";
import { Program, BN, web3 } from "@project-serum/anchor";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert, expect } from "chai";
import { VayooContracts } from "../target/types/vayoo_contracts";
import { superUserKey, testUserKey } from "./testKeys";
import { sleep, toNativeAmount, toUiAmount } from "./utils";
import { GLOBAL_STATE_SEED, ONE_WEEK_IN_SECONDS, PYTH_FEED, UNDERLYING_MINT, USDC_MINT } from "./utils/constants";

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

  let accounts: any = {
    collateralMint: usdcMint,
    underlyingMint,
    pythFeed,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY
  }

  if (DEBUG_MODE) {
    console.log("Super User Key: ", superUser.publicKey.toString());
    console.log("Test User Key: ", testUser.publicKey.toString());
  }

  before("Setting up environment", async () => {
    const txHash = await connection.requestAirdrop(superUser.publicKey, LAMPORTS_PER_SOL);
    await connection.requestAirdrop(testUser.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(txHash);
  })

  it("Create Global State", async () => {
    const [globalStateKey, globalStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_STATE_SEED)], program.programId)
    accounts.globalState = globalStateKey

    await program.methods.createGlobalState(globalStateKeyBump).accounts({
      ...accounts,
      authority: superUser.publicKey
    }).signers([superUser]).rpc();
    
    const globalStateAccount = await program.account.globalState.fetch(globalStateKey);
    DEBUG_MODE ? console.log("Global State Key: ", globalStateKey.toString()) : null;
    assert.ok(globalStateAccount.totalTvlUsdc.toNumber() == 0);
  });

  it("Initialize Contract Account/State", async () => {
    const contractName = "v0";
    const timeNow = Math.floor(Date.now() / 1000)
    const contractEndTime = new BN(timeNow + ONE_WEEK_IN_SECONDS);
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), underlyingMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    accounts.contractState = contractStateKey;
    accounts.contractAuthority = superUser.publicKey;

    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime).accounts({
      ...accounts
    }).signers([superUser]).rpc();

    const contractStateAccount = await program.account.contractState.fetch(contractStateKey);
    DEBUG_MODE ? console.log("Contract State Key: ", contractStateKey.toString()) : null;
    assert.ok(contractStateAccount.isHalted == false);
    assert.ok(contractStateAccount.pythFeedId.equals(pythFeed));
  });

  it("Initialize User State for test user", async () => {
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([accounts.contractState.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    accounts.userState = userStateKey;
    accounts.userAuthority = testUser.publicKey;

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts
    }).signers([testUser]).rpc();


    const userStateAccount = await program.account.userState.fetch(userStateKey);
    DEBUG_MODE ? console.log("User State Key: ", userStateKey.toString()) : null;
    assert.ok(userStateAccount.usdcDeposited.toNumber() == 0);
  });

  it("Create ATAs for test user", async () => {
    await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    await getOrCreateAssociatedTokenAccount(connection, testUser, underlyingMint, testUser.publicKey, true);
    await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, accounts.userState, true);
    await getOrCreateAssociatedTokenAccount(connection, testUser, underlyingMint, accounts.userState, true);
  });

  it("Deposit Collateral for test User", async () => {
    const userUsdcAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const userUsdcVaultAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, accounts.userState, true);
    const amountToDeposit = new BN(toNativeAmount(0.02, USDC_MINT.decimals));
    accounts.userCollateralAta = userUsdcAtaBefore.address;
    accounts.vaultCollateralAta = userUsdcVaultAta.address;

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts
    }).signers([testUser]).rpc();
    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);

    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.usdcDeposited.eq(amountToDeposit));
    assert.ok(Number(userUsdcAtaBefore.amount - userUsdcAtaAfter.amount) == amountToDeposit.toNumber())
  });

  it("Withdraw Collateral for test User", async () => {
    const userUsdcAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const amountToWithdraw = new BN(toNativeAmount(0.01, USDC_MINT.decimals));

    await program.methods.withdrawCollateral(amountToWithdraw).accounts({
      ...accounts
    }).signers([testUser]).rpc();

    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, testUser.publicKey, true);
    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.usdcDeposited.eq(amountToWithdraw));
    assert.ok(Number(userUsdcAtaAfter.amount - userUsdcAtaBefore.amount) == amountToWithdraw.toNumber())
  });

  it("Cannot create user state - Contract Ended", async () => {
    let msg = '';
    const contractName = "v1";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 3); // 3 seconds into the future
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), underlyingMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)

    // init contract with 10 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime).accounts({
      ...accounts,
      contractState: contractStateKey
    }).signers([superUser]).rpc();

    // delay by 4 seconds
    await sleep(4);

    // try to create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });

  it("Cannot deposit - Contract Ended", async () => {
    let msg = '';
    const contractName = "v2";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 4); // 4 seconds into the future
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), underlyingMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)

    // init contract with 4 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime).accounts({
      ...accounts,
      contractState: contractStateKey
    }).signers([superUser]).rpc();

    // create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
    }).signers([testUser]).rpc();

    // delay by 5 seconds
    await sleep(5);

    const userUsdcVaultAta = await getOrCreateAssociatedTokenAccount(connection, testUser, usdcMint, userStateKey, true);
    const amountToDeposit = new BN(toNativeAmount(0.02, USDC_MINT.decimals));

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultCollateralAta: userUsdcVaultAta.address,
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });
});
