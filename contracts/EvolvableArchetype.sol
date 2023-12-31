// SPDX-License-Identifier: MIT
// Based on ERC721A Implementation.

import "@openzeppelin/contracts/access/Ownable.sol";
import "solady/src/utils/MerkleProofLib.sol";
import "solady/src/utils/LibString.sol";
import "solady/src/utils/SafeTransferLib.sol";
import { FixedPointMathLib as Math } from "solady/src/utils/FixedPointMathLib.sol";
import "./interfaces/IEvolutionStrategy.sol";
import "./ERC721S.sol";


pragma solidity ^0.8.10;

/**
 * @dev Staking data will still be calculated as expected by ERC721S.
 *      Thus, this value is only used for determining the total stake
 *      of an user based on its ERC721S staking data.
 *
 * - NONE: Staking disabled.
 * - CURRENT: Stake linear to the time the token was last time staked.
 * - ALIVE: Stake linear to the deployment time.
 * - CUMULATIVE: Stake linear to the sum of all staking times.
 */
enum StakingType {
    NONE, CURRENT, ALIVE, CUMULATIVE
}

struct StateLocks {
    bool stakingConfigLocked;
    bool priceLocked;
    bool baseUriLocked;
    bool evolutionStakeStrategyLocked;
    bool evolutionCalculatorStrategyLocked;
    bool whitelistMerkleRootLocked;
    bool whitelistPriceLocked;
    bool stakeOnWhitelistMintLocked;
}

/**
 * @dev PoC ERC721 contract with evolution and staking mechanics.
 */
contract EvolvableArchetype is ERC721S, Ownable {
    
    uint88 private _price;
    string private _baseUri;
    StakingType private _evolutionStakeStrategy;
    address private _evolutionStrategy;

    StateLocks private _locks;

    // @dev The root whitelist will be generally used for cheaper or
    //      free mints that will automatically get staked based on
    //      the staking config.
    bytes32 private _whitelistMerkleRoot;
    mapping (address => uint64) private _amountClaimedFromRoot;
    uint88 private _whitelistPrice;
    bool private _automaticallyStakeOnWhitelistMint;


    constructor(
        DeploymentConfig memory config_,
        uint88 price,
        string memory baseUri,
        StakingType evolutionStakeStrategy,
        address evolutionCalculatorStrategy
    ) ERC721S(config_) { 
        _price = price;
        _baseUri = baseUri;
        _evolutionStakeStrategy = evolutionStakeStrategy;
        _evolutionStrategy = evolutionCalculatorStrategy;
    }

    function publicMint(address to, uint64 quantity) public payable {
        require(msg.value == quantity * _price);
        _mint(to, quantity, false);
    }

    function whitelistMint(
        address to,
        uint64 quantity,
        uint64 listLimit,
        bytes32[] calldata proof
    ) public payable {
        verifyRootMint(proof, to, listLimit, quantity);
        require(msg.value == quantity * _whitelistPrice);
        _mint(to, quantity, _automaticallyStakeOnWhitelistMint);
    }

    /**
     * @dev Verifies that `minter` can mint `quantity` from the merkle root whitelist.
     * @param listLimit Will be the max amount that `msg.sender` can mint for
     *        `whitelistMerkleRoot`. Requires that `listLimit >= quantity`.
     * @param quantity The number of tokens to mint from the whitelist.
     */
	function verifyRootMint(
		bytes32[] memory proof, address minter, uint64 listLimit, uint64 quantity
	) internal {
        bytes32 root = _whitelistMerkleRoot;
        require(root != bytes32(0));
        uint64 currentAmountClaimedFromRoot = _amountClaimedFromRoot[minter];

        uint64 newAmountClaimedFromRoot = quantity + currentAmountClaimedFromRoot;
        require(listLimit >= newAmountClaimedFromRoot);
        _amountClaimedFromRoot[minter] = newAmountClaimedFromRoot;

        require(MerkleProofLib.verify(
            proof, root, keccak256(abi.encodePacked(minter, listLimit))
        ));
    }

    function tokenURI(uint256 tokenId) 
        public 
        view
        virtual
        override
        returns (string memory)
    {
        string memory baseUri = _baseUri;
        if (bytes(baseUri).length == 0) return "";

        return string(abi.encodePacked(
            baseUri,
            LibString.toString(getEvolution(tokenId)),
            "/",
            LibString.toString(tokenId)
        ));
    }
    
    function getEvolution(uint256 tokenId) public view returns (uint256) {
        uint256 stake = getStake(tokenId, _evolutionStakeStrategy);
        return IEvolutionStrategy(_evolutionStrategy).getEvolution(stake, tokenId);
    }

    function getStake(
        uint256 tokenId, StakingType strategy
    ) public view returns (uint256) {
        TokenOwnership memory stake = _ownershipOf(tokenId);
        uint32 deploymentTime = _config.deployTime;

        if (strategy == StakingType.CURRENT) {
            uint256 stakingStart = deploymentTime + stake.stakingStart;
            uint256 stakingEnd = stakingStart + stake.stakingDuration;
            return Math.min(
                block.timestamp - stakingStart,
                stakingEnd - stakingStart
            );
        }

        if (strategy == StakingType.ALIVE) 
            return block.timestamp - deploymentTime;

        if (strategy == StakingType.CUMULATIVE) {
            uint256 stakingStart = deploymentTime + stake.stakingStart;
            uint256 stakingEnd = stakingStart + stake.stakingDuration;
            uint256 currentTimeStaked = Math.min(
                block.timestamp - stakingStart,
                stakingEnd - stakingStart
            );

            return stake.totalStakedTime + currentTimeStaked;
        }

        return 0;
    }



    /* ---------------------- GENERAL CONTRACT CONFIG ---------------------- */

    // TODO Minimal state should be stored in the ERC721S. All staking info
    // should be abstracted and relativized to the impl (so different config
    // apply to different conditions).
    function changeStakingConfig(
        uint32 minStakingTime,
        uint32 automaticStakeTimeOnMint,
        uint32 automaticStakeTimeOnTx
    ) public onlyOwner {
        require(!_locks.stakingConfigLocked);
        _config.minStakingTime = minStakingTime;
        _config.automaticStakeTimeOnMint = automaticStakeTimeOnMint;
        _config.automaticStakeTimeOnTx = automaticStakeTimeOnTx;
    }

    function setPrice(uint88 newPrice) public onlyOwner {
        require(!_locks.priceLocked);
        _price = newPrice;
    }

    function setBaseUri(string memory newBaseUri) public onlyOwner {
        require(!_locks.baseUriLocked);
        _baseUri = newBaseUri;
    }

    function setEvolutionStakeStrategy(StakingType newEvolutionStakeStrat) public onlyOwner {
        require(!_locks.evolutionStakeStrategyLocked);
        _evolutionStakeStrategy = newEvolutionStakeStrat; 
    }

    function setEvolutionCalculatorStrategy(address newEvolutionCalculator) public onlyOwner {
        require(!_locks.evolutionCalculatorStrategyLocked);
        _evolutionStrategy = newEvolutionCalculator;
    }

    function setWhitelistMerkleRoot(bytes32 root) public onlyOwner {
        require(!_locks.whitelistMerkleRootLocked);
        _whitelistMerkleRoot = root;
    }

    function setWhitelistPrice(uint88 price) public onlyOwner {
        require(!_locks.whitelistPriceLocked);
        _whitelistPrice = price;
    }

    function setIfWhitelistMintsShouldAutomaticallyGetStaked(bool automaticallyStake) public onlyOwner {
        require(!_locks.stakeOnWhitelistMintLocked);
        _automaticallyStakeOnWhitelistMint = automaticallyStake;
    }


    /* ----------------------- GENERAL CONTRACT LOCKS ---------------------- */

    function lockStakingConfigForever() public onlyOwner {
        _locks.stakingConfigLocked = true; 
    }

    function lockPriceForever() public onlyOwner {
        _locks.priceLocked = true; 
    }

    function lockBaseUriForever() public onlyOwner {
        _locks.baseUriLocked = true; 
    }

    function lockEvolutionStakeStrategyForever() public onlyOwner {
        _locks.evolutionStakeStrategyLocked = true;
    }

    function lockEvolutionCalculatorStrategyForever() public onlyOwner {
        _locks.evolutionCalculatorStrategyLocked = true;
    }

    function lockWhitelistMerkleRoot() public onlyOwner {
        _locks.whitelistMerkleRootLocked = true;
    }

    function lockWhitelistPrice() public onlyOwner {
        _locks.whitelistPriceLocked = true;
    }

    function lockIfWhitelistMintsShouldAutomaticallyGetStaked(bool automaticallyStake) public onlyOwner {
        require(!_locks.stakeOnWhitelistMintLocked);
        _automaticallyStakeOnWhitelistMint = automaticallyStake;
    }


    /* -------------------------- EXTRA FUNCTIONS -------------------------- */
    function withdraw() public onlyOwner {
        SafeTransferLib.forceSafeTransferETH(msg.sender, address(this).balance);
    }
}
