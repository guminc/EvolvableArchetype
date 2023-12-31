import { expect } from 'chai'
import { ethers } from 'hardhat'
import { checkOwnerships, deployMinimalErc721S } from '../scripts/helpers'
import { getRandomFundedAccount, randomAddress, sleep } from '../scripts/functionalHelpers'
import * as S from 'fp-ts/string'
import { experimentalAddHardhatNetworkMessageTraceHook } from 'hardhat/config'

describe('ERC721S', () => {

    describe('Minting and transfering', () => {
        it('should be able to deploy', async () => {
            await deployMinimalErc721S({ })
        })

        it('should be able to mint', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: (60 * 60 * 24) })
            const owner = randomAddress()
            await nft.mintAndStake(owner, 1)
            await nft.mint(owner, 1)

            expect(await nft.balanceOf(owner)).eq(2)
            expect(await nft.ownerOf(1).then(S.toLowerCase)).eq(owner)
            expect(await nft.ownerOf(2).then(S.toLowerCase)).eq(owner)
        })

        it('should be able to mint multiple tokens', async () => {
            const nft = await deployMinimalErc721S({})
            const owner1 = randomAddress()
            const owner2 = randomAddress()

            await nft.mint(owner1, 2)
            await nft.mint(owner2, 3)

            expect(await nft.balanceOf(owner1)).eq(2)
            expect(await nft.balanceOf(owner2)).eq(3)

            expect(await nft.ownerOf(1).then(S.toLowerCase)).eq(owner1)
            expect(await nft.ownerOf(2).then(S.toLowerCase)).eq(owner1)
            expect(await nft.ownerOf(3).then(S.toLowerCase)).eq(owner2)
            expect(await nft.ownerOf(4).then(S.toLowerCase)).eq(owner2)
            expect(await nft.ownerOf(5).then(S.toLowerCase)).eq(owner2)
        })

        it('should\'t be able to tx if staked on mint', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: (60 * 60 * 24) })
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()
            await nft.mintAndStake(owner.address, 1)

            await expect(nft.connect(owner).transferFrom(owner.address, ownerAlt, 1)).reverted
        })

        it('should be able to tx if not staked on mint', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: (60 * 60 * 24) })
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()
            await nft.mint(owner.address, 1)
            await nft.connect(owner).transferFrom(owner.address, ownerAlt, 1)

            expect(await nft.balanceOf(owner.address)).eq(0)
            expect(await nft.balanceOf(ownerAlt)).eq(1)
            expect(await nft.ownerOf(1).then(S.toLowerCase)).eq(ownerAlt)
        })

        it('should be able to tx after stake on mint', async () => {
            const automaticStakeTimeOnMint = 2
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint })
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()
            await nft.mintAndStake(owner.address, 1)

            await expect(nft.connect(owner).transferFrom(owner.address, ownerAlt, 1)).reverted
            sleep(automaticStakeTimeOnMint)
            await nft.connect(owner).transferFrom(owner.address, ownerAlt, 1)

            expect(await nft.balanceOf(owner.address)).eq(0)
            expect(await nft.balanceOf(ownerAlt)).eq(1)
            expect(await nft.ownerOf(1).then(S.toLowerCase)).eq(ownerAlt)
        })

        it('shouldn\'t be able to tx on staked batch on mint', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: (60 * 60 * 24) })
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()
            await nft.mintAndStake(owner.address, 3)

            const tryToTx = async (n: number) => 
                await nft.connect(owner).transferFrom(owner.address, ownerAlt, n)

            await expect(tryToTx(1)).reverted
            await expect(tryToTx(2)).reverted
            await expect(tryToTx(3)).reverted
        })

        it('should be able to tx batch after stake on mint', async () => {
            const automaticStakeTimeOnMint = 4
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint })
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()
            // We mint `automaticStakeTimeOnMint - 1` because after trying to
            // tx each token up to that number, the staking time will pass.
            await nft.mintAndStake(owner.address, automaticStakeTimeOnMint - 1)

            const tryToTx = async (n: number) => 
                await nft.connect(owner).transferFrom(owner.address, ownerAlt, n)

            await expect(tryToTx(1)).reverted
            await expect(tryToTx(2)).reverted
            await expect(tryToTx(3)).reverted

            await tryToTx(1)
            await tryToTx(2)
            await tryToTx(3)
        })

        it('should be able to mint big batch cheap', async () => {
            const amountToMint = 20
            const maxGas = 120000
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: 1 })
            const owner = await getRandomFundedAccount()

            const tx = await nft.mint(owner.address, amountToMint)
            const receipt = await tx.wait()
            expect(receipt.gasUsed).lt(maxGas)
        })

        it('should be able to mint and stake big batch cheap', async () => {
            const amountToMint = 20
            const maxGas = 120000
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnMint: 1 })
            const owner = await getRandomFundedAccount()

            const tx = await nft.mintAndStake(owner.address, amountToMint)
            const receipt = await tx.wait()
            expect(receipt.gasUsed).lt(maxGas)
        })
    })

    describe('Complex transfering', () => {
        it('should let tx whole batch', async () => {
            const nft = await deployMinimalErc721S({})
            const owner = await getRandomFundedAccount()
            const ownerAlt = randomAddress()

            await nft.mint(owner.address, 3)
            await nft.connect(owner).transferFrom(owner.address, ownerAlt, 2)
            await nft.connect(owner).transferFrom(owner.address, ownerAlt, 3)
            await nft.connect(owner).transferFrom(owner.address, ownerAlt, 1)
        })

        it('shouldn\'t be able to break ownership by transfering inner token', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnTx: 0 })
            const owner1 = await getRandomFundedAccount()
            const owner2 = await getRandomFundedAccount()

            await nft.mint(owner1.address, 3)
            await nft.mint(owner2.address, 2)

            const expectedOwnership = {
                1: owner1.address,
                2: owner1.address,
                3: owner1.address,
                4: owner2.address,
                5: owner2.address
            }

            await checkOwnerships(expectedOwnership, nft) 

            await nft.connect(owner1).transferFrom(owner1.address, owner2.address, 2)
            expectedOwnership[2] = owner2.address
            await checkOwnerships(expectedOwnership, nft) 
            await expect(nft.connect(owner1).transferFrom(owner1.address, owner2.address, 2)).reverted

            await nft.connect(owner1).transferFrom(owner1.address, owner2.address, 3)
            expectedOwnership[3] = owner2.address
            await checkOwnerships(expectedOwnership, nft) 
            await expect(nft.connect(owner1).transferFrom(owner1.address, owner2.address, 3)).reverted

            await nft.connect(owner2).transferFrom(owner2.address, owner1.address, 5)
            expectedOwnership[5] = owner1.address
            await checkOwnerships(expectedOwnership, nft)
            await expect(nft.connect(owner1).transferFrom(owner1.address, owner2.address, 3)).reverted

            await nft.connect(owner1).transferFrom(owner1.address, owner2.address, 1)
            expectedOwnership[1] = owner2.address
            await checkOwnerships(expectedOwnership, nft)

            await nft.connect(owner1).transferFrom(owner1.address, owner2.address, 5)
            expectedOwnership[5] = owner2.address
            await checkOwnerships(expectedOwnership, nft)
        })
    })

    describe('Approval tests', () => {
         
    })
    
    describe('Pure tests', () => {
        it('should have right ownership on simple tx', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnTx: 0 })
            const owner = randomAddress()
            const altOwner = randomAddress()
            await nft.mint(owner, 1)

            const owneship = await nft.packOwnershipDataForTx(altOwner, 0)
            const addr = owneship.and(BigInt(2**160) - 1n)
            expect(addr.toHexString().toLowerCase()).eq(altOwner)
        })


        it('should have right staking start on simple tx', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnTx: 0 })
            const owner = randomAddress()
            const altOwner = randomAddress()
            await nft.mint(owner, 1)

            const ownership = await nft.packOwnershipDataForTx(altOwner, 0)
            expect(
                ownership.and(BigInt(2**160) - 1n).toHexString().toLowerCase()
            ).eq(altOwner)
            expect(
                ownership.shr(192).and(BigInt(2**32) - 1n)
            ).eq(0)
        })

        it.only('should have right total staked time after disabling staking', async () => {
            const nft = await deployMinimalErc721S({ automaticStakeTimeOnTx: 0 })
            const owner = randomAddress()
            await nft.mint(owner, 1)

            const oldOwnership = (BigInt(1) << BigInt(224))
            const ownership = await nft.packOwnershipDataForTx(ethers.constants.AddressZero, oldOwnership)
            expect(ownership).eq(BigInt(1) << BigInt(160))
        })



    })


})

