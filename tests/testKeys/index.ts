import { Keypair, PublicKey } from "@solana/web3.js";
import keyArrSuper from "./superUser.json";
import keyArrTest from "./testUser.json";

export class Key {
    name: string;
    keypairArr: Uint8Array;
    keypair: Keypair;
    pubKey: PublicKey;

    constructor(name: string, keypairArr: number[]) {
        this.name = name;
        this.keypairArr = new Uint8Array(keypairArr as any[]);
        this.keypair = Keypair.fromSecretKey(this.keypairArr);
        this.pubKey = this.keypair.publicKey;
    }
}

export const superUserKey = new Key(
    "super",
    keyArrSuper
);

export const testUserKey = new Key(
    "test",
    keyArrTest
);
