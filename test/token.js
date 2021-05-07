const RBAC = artifacts.require("RBAC");
const REGISTRY = artifacts.require("LKGRegistry");
const SupplyChainToken = artifacts.require("SupplyChainNFT")
const Chance = require('chance');
const toBN = web3.utils.toBN;
const { constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');



//References
//Truffle test in JavaScript : https://www.trufflesuite.com/docs/truffle/testing/writing-tests-in-javascript
//Truffle Contract Guide : https://www.trufflesuite.com/docs/truffle/getting-started/interacting-with-your-contracts
//Truffle Contract Package : https://github.com/trufflesuite/truffle/tree/master/packages/contract
//Mocha Documentation : https://mochajs.org/#getting-started
//Chai Assert API : https://www.chaijs.com/api/assert/
//Chai Expect/Should API : https://www.chaijs.com/api/bdd/
//OpenZeppelin Test Helpers API : https://docs.openzeppelin.com/test-helpers/0.5/api
//web3 API : https://web3js.readthedocs.io/en/v1.2.11/
//chance.js : https://chancejs.com/
//bn.js : https://github.com/indutny/bn.js/
//JavaScript Reference (MDN) : https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference
//The Modern JavaScript Tutorial : http://javascript.info/

contract("NF-Token Test Suite", async accounts => {
    let chance_instance;
    let rbac_admin;
    let rbac;
    let registry;
    let owner_of_token_contract;
    let cotton_token;
    var control_addresses = [];
    var supply_chain_addresses = [];

    "use strict";

    // deploy contracts used to test
    async function deployContracts() {
        let chance = new Chance();
        let rbac_admin_address = accounts[0];
        let rbac = await RBAC.new({ from: rbac_admin_address });
        let registry = await REGISTRY.new(rbac.address)
        let token_contract_owner = accounts[5];
        let token = await SupplyChainToken.new("Cotton", "CT", registry.address, rbac.address, {from: token_contract_owner})
        return [chance, rbac_admin_address, rbac, registry, token_contract_owner, token];
    }

    // setup environment before tests
    before(async () => {
        // deploy contracts
        [chance_instance, rbac_admin, rbac, registry, owner_of_token_contract, cotton_token] = await deployContracts();

        // setup addresses
        control_addresses = accounts.slice(1, 3);
        supply_chain_addresses = accounts.slice(3, 8);
        normal_addresses = accounts.slice(8, 9);

        // add supply chain admin role to rbac_admin so he can add entities to the registry
        rbac.addMember(rbac_admin, "ADMIN", {from: rbac_admin});

        // add address of nf token contract to supply chain admin role
        rbac.addMember(cotton_token.address, "ADMIN", { from: rbac_admin });

        // assign roles to addresses and add them to registry
        control_addresses.forEach(address => {
            rbac.addMember(address, "CONTROL", { from: rbac_admin });
            registry.addControlEntity(address, {role: 0, description: "tier 4", gseStatus: 0, numberOfControls: 0}, {from: rbac_admin});
        });

        supply_chain_addresses.forEach(address => {
            rbac.addMember(address, "SUPPLY_CHAIN_ENTITY", { from: rbac_admin });
            registry.addSupplyChainEntity(address, {role: 0, tier: "tier 4", gseStatus: 0, controls: [], transactions: []}, {from: rbac_admin});
        });

        const output = [];
        for (const acct of accounts) {
            await web3.eth.personal.unlockAccount(acct);
            await output.push([acct, await web3.eth.getBalance(acct)]);
        }

        console.debug(`The number of accounts : ${accounts.length}`);
        console.table(output);
    });

    
    it("Create Token contract and token fields", async () => {
        assert.strictEqual(await cotton_token.name(), "Cotton");
        assert.strictEqual(await cotton_token.symbol(), "CT");
    });

    it("Try to mint a new token from an address other than the owner", async () => {
        let token_owner = supply_chain_addresses[0];
        await expectRevert.unspecified(cotton_token.mintToken(token_owner, {itemId: 241, sourceItemIds: []}, {from: token_owner}), "Only token contract owner can mint new tokens");
        ;
    });

    it("Mint a new token and then transfer it to another supply chain member (sender and receiver gse OK))", async () => {
        let future_owner = supply_chain_addresses[3];
        let future_future_owner = supply_chain_addresses[4];

        // acknowledge GSE status
        await registry.acknowledgeGSE({from: future_owner});
        await registry.acknowledgeGSE({from: future_future_owner});

        // mint new token
        let tokenID = await cotton_token.mintToken(future_owner, {itemId: 241, sourceItemIds: []}, {from: owner_of_token_contract});
        
        //check that the token was created correctly
        assert.strictEqual(await cotton_token.ownerOf(1), future_owner, {from: owner_of_token_contract});
        
        // transfer token
        let transfer = await cotton_token.transferToken(future_owner, future_future_owner, 1, {from: future_owner});
        await expectEvent(transfer, 'Transfer');

        // check that the token was transferred correctly
        assert.strictEqual(await cotton_token.ownerOf(1), future_future_owner, {from: future_future_owner});
        
        let entity_future_owner = await registry.getSupplyChainEntity(future_owner, {from: future_owner})
        let entity_future_future_owner= await registry.getSupplyChainEntity(future_future_owner, {from: future_future_owner});
        
        // check that the valid transaction was recorded as valid (thus not added to the entities)
        assert.equal(entity_future_owner[4].length, 0);
        assert.equal(entity_future_future_owner[4].length, 0)
    });

    it("Mint a new token and then transfer it to another supply chain member (sender gse OK, receiver gse NOK)", async () => {
        let future_owner = supply_chain_addresses[1];
        let future_future_owner = supply_chain_addresses[2];

        // acknowledge GSE status
        await registry.acknowledgeGSE({from: future_owner});

        // mint new token
        await cotton_token.mintToken(future_owner, {itemId: 456, sourceItemIds: [241]}, {from: owner_of_token_contract});
        
        //check that the token was created correctly
        assert.strictEqual(await cotton_token.ownerOf(2), future_owner, {from: owner_of_token_contract});
        
        // transfer token
        let transfer = await cotton_token.transferToken(future_owner, future_future_owner, 2, {from: future_owner});
        await expectEvent(transfer, 'Transfer');
        await expectEvent(transfer, 'NonGSETransaction');

        // check that the token was transferred correctly
        assert.strictEqual(await cotton_token.ownerOf(2), future_future_owner, {from: future_future_owner});
        
        let entity_future_owner = await registry.getSupplyChainEntity(future_owner, {from: future_owner})
        let entity_future_future_owner= await registry.getSupplyChainEntity(future_future_owner, {from: future_future_owner});
        
        // check that the valid transaction was recorded as valid (thus not added to the entities)
        assert.equal(entity_future_owner[4].length, 0);
        assert.equal(entity_future_future_owner[4].length, 1)
    });

    it("Mint a new token and then transfer it to another supply chain member (sender and receiver gse NOK)", async () => {
        let future_owner = supply_chain_addresses[0];
        let future_future_owner = supply_chain_addresses[2];

        // mint new token
        await cotton_token.mintToken(future_owner, {itemId: 123, sourceItemIds: [241, 456]}, {from: owner_of_token_contract});
        
        //check that the token was created correctly
        assert.strictEqual(await cotton_token.ownerOf(3), future_owner, {from: owner_of_token_contract});
        
        // transfer token
        let transfer = await cotton_token.transferToken(future_owner, future_future_owner, 3, {from: future_owner});
        await expectEvent(transfer, 'Transfer');
        await expectEvent(transfer, 'NonGSETransaction');

        // check that the token was transferred correctly
        assert.strictEqual(await cotton_token.ownerOf(3), future_future_owner, {from: future_future_owner});
        
        let entity_future_owner = await registry.getSupplyChainEntity(future_owner, {from: future_owner})
        let entity_future_future_owner= await registry.getSupplyChainEntity(future_future_owner, {from: future_future_owner});
        
        // check that the valid transaction was recorded as valid (thus not added to the entities)
        assert.equal(entity_future_owner[4].length, 1);
        assert.equal(entity_future_future_owner[4].length, 2);

        // get metadata and check if chain of custody is recorded on token
        let tokenMetadata = await cotton_token.getTokenMetadata(3);
        assert.equal(tokenMetadata[1][0], 241);
        assert.equal(tokenMetadata[1][1], 456);
    });

});