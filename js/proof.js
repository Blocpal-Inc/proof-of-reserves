const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MerkleTools = require('merkle-tools');
const Sha256 = require('crypto-js/sha256');

const CSV_DELIMITER = ',';
const NEW_LINE = '\r\n';
const AUDIT_FILE_PATH_TEMPLATE = 'https://raw.githubusercontent.com/Blocpal-Inc/proof-of-reserves/master/audit_files/BlocPalX_ProofOfReserves_PROOFDATE_merkletree.txt';

/**
 * jQuery HTML interface
 */
$(function() {
	let exchangeFileContent, exchangeFileName, merkleFileContent, merkleFilePath, merkleFileName, proofSentence, sentenceProofId, sentenceBalances;

	// extract everything we can when they paste the proof sentence
	//   also reset everything with every change
	$('.inputProofSentence').on('input', function(event) {
		merkleFileContent = undefined;
		$('.stepOneUnlock').hide();
		$('.stepTwoUnlock').hide();
		$('.stepThreeUnlock').hide();
		$('.stepFourUnlock').hide();

		proofSentence = $('.inputProofSentence').val().trim();

		/*
			This is the user string creation used by the BlocPalX Exchange

			The BlocPalX client identified as [userDataChunk]
			and Account Public Code [accountPublicCode]
			was included in the [proofDateId] audit
			and had balances of [" + balanceA + " " + assetA +
			" : " + balanceB + " " + assetB +
			" : " + balanceC + " " + assetC +
			"] on deposit at the time.
		*/
		
		const matches = proofSentence.match(/\[[a-zA-Z0-9-\@\*\:\.\s]+?\]/g);
		if (matches.length >= 3) {
			const personalString = matches[0].replace(/[\[\]]+/g, '');
			$('.personalString').html(personalString);
			const pubCode = matches[1].replace(/[\[\]]+/g, '');
			$('.pubCode').html(pubCode);
			sentenceProofId = matches[2].replace(/[\[\]]+/g, '');
			$('.sentenceProofId').html(sentenceProofId);
			if (matches[3]) {
				sentenceBalances= matches[3].replace(/[\[\]]+/g, '');
				$('.balancesString').html(sentenceBalances);
			}

			if (sentenceProofId && sentenceProofId !== '') {
				merkleFilePath = AUDIT_FILE_PATH_TEMPLATE.replace('PROOFDATE', sentenceProofId.replace(' ', '_'));
				const htmlLink = '<a href="' + merkleFilePath + '" target="_blank" rel="noopener noreferrer">' + merkleFilePath + '</a>';
				$('.downloadFilePath').html(htmlLink);
				$('.stepOneUnlock').show();
			}
		}
	});

	// load the audit file into RAM from gitlab
	//   At some point as file size grows users will have RAM issues and our third party partners will have to start
	//   processing requests server-side.  Until then, we'll keep it client-side for transparency.
	$('.loadAuditFileButton').click(async function() {
		const xhr = new XMLHttpRequest();
		xhr.open('GET', merkleFilePath);
		xhr.timeout = 3000;

		xhr.addEventListener('load', function() {
			$('.stepOneStatus').html('Connecting...');
		});
		xhr.addEventListener('error', function (event) {
			$('.stepOneStatus')
				.removeClass("boldGreen")
				.addClass("boldRed")
				.html('Error: ');
		});
		xhr.addEventListener('progress', function (event) {
			if (event.lengthComputable) {
				$('.stepOneStatus').html(`Progress: ${event.loaded}/${event.total} (${((event.loaded / event.total) * 100)}%)`);
			}
		});
		xhr.onloadend = function() {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					merkleFileContent = xhr.responseText;
					merkleFileName = merkleFilePath.substring(merkleFilePath.lastIndexOf('/')+1);
					$('.stepOneStatus')
						.addClass("boldGreen")
						.removeClass("boldRed")
						.html('File loaded! Move on to Step 2');
					$('.stepTwoUnlock').show();
				} else {
					$('.stepOneStatus')
						.removeClass("boldGreen")
						.addClass("boldRed")
						.html('Error: ' + xhr.status + ' ' + xhr.statusText + ' (are you sure that was a valid proof date?)');
				}
			}
		}
		xhr.send();
	});

	// verify user input of (inputProofSentence) within the Merkle tree
	$('.verifyButton').click(function() {
		const params = {
			proofSentence: proofSentence,
			proofId: sentenceProofId,
			sentenceBalances: sentenceBalances,
			merkleFileName: merkleFileName,
			merkleFilePath: merkleFilePath,
		};
		verifyProofSentence(merkleFileContent, params);
	});

	// upload exchange generated CSV to use in creating the Merkle tree
	$('.exchangeFileUpload').change(function(event) {
		const files = event.target.files;
		exchangeFileName = files[0].name;
		const input = event.target;
		const reader = new FileReader();
		reader.onload = function() {
			if (reader.result) {
				// retrieve file content
				exchangeFileContent = reader.result;
			}
		};
		reader.readAsText(input.files[0]);
	});

	// create Merkle tree with user input of a list of (email, public code, ExchangeBalanceArray)
	$('.generateMerkleTree').click(function() {
		generateMerkleTree(exchangeFileContent, exchangeFileName);
	});

});


/**
 * validate a user's proof sentence
 *
 * @method verifyProofSentence
 * @param {String} merkleFileContent verification file with all hashed values
 * @param {Object} params  containing a proof story to be verified
 * @return void
 */
function verifyProofSentence(merkleFileContent, params) {
	if (!merkleFileContent) {
		$('.stepTwoStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: proof file has not been loaded.');
		return;
	}
	if (!params.proofSentence) {
		$('.stepTwoStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: proof sentence has not been loaded.');
		return;
	}

	$('.merkleFileName').html(params.merkleFileName);

	let totalBalances = {};
	let sourceRootHash = '';
	let sourceBalanceTotals = '';

	const user_hash = Sha256(params.proofSentence).toString();

	// this is the user's computed hash that they can search for in the Merkle Tree Proofs file
	// let user_hash = user_data_hash.toString().substring(0, LEAVES_HASH_LEN);
	$('.computedUserHash').html(user_hash);

	// process the Merkle Tree Proofs file and assemble all the leaves
	let list = merkleFileContent.split(/\r?\n/);
	let leaves = [];
	let hashFileLineNumber = undefined;
	let hashFileUserRewardCode = undefined;
	let hashFileSentenceBalances = undefined;
	let userMerkleHash = undefined;
	for (let i = 1; i < list.length; i++) {
		const row = list[i];
		if (row.startsWith('#') || row.trim() == '') continue;

		if (i === 1) {
			const data = row.split(':');
			if (data[1]) {
				const proofDate = data[1].trim();
				$('.fileProofDate').html(proofDate);
				if (proofDate !== params.proofId) {
					$('.stepTwoStatus')
						.removeClass("boldGreen")
						.addClass("boldRed")
						.html('Error: proof file and proof sentence date/id mismatch');
					return;
				}
			} else {
				$('.stepTwoStatus')
					.removeClass("boldGreen")
					.addClass("boldRed")
					.html('Error: invalid BlocPalX Merkle tree file');
				return;
			}
		} else if (i === 2) {
			const data = row.split(':');
			sourceRootHash = data[1].trim();
		} else if (i === 3) {
			const data = row.split(':');
			sourceBalanceTotals = data[1].trim();
		} else if (i === 4) {
			const data = row.split(CSV_DELIMITER);
			if (data[0] !== 'proofSentenceHash') {
				$('.stepTwoStatus')
					.removeClass("boldGreen")
					.addClass("boldRed")
					.html('Error: Invalid BlocPalX Merkle Tree file');
				return;
			}
		} else {
			const c = row.split(CSV_DELIMITER);
			if (c.length < 2) continue;

			const thisUserHash = c[0].trim();
			const thisUserBalance = c[1].trim();

			if (thisUserBalance !== 'none') {
				const balances = thisUserBalance.split(':');
				for (let j = 0; j < balances.length; j++) {
					const balanceInfo = balances[j].trim().split(' ');
					const asset = balanceInfo[1].trim();
					totalBalances[asset] = (totalBalances[asset] || 0) + Number(balanceInfo[0].trim()); // calculate total balance
				}
			}

			// concatenate the user proof sentence hash and the balances into a hash for the merkle tree
			let merkleHash = Sha256(thisUserHash + ',' + thisUserBalance).toString();

			leaves.push(merkleHash);

			if (user_hash === thisUserHash) {
				userMerkleHash = merkleHash;
				hashFileLineNumber = i+1;
				hashFileUserRewardCode = c[2].trim();
				hashFileSentenceBalances = thisUserBalance;
			}
		}
	}
	$('.userNums').html(leaves.length);

	let balArr=[];
	Object.keys(totalBalances).forEach(function(asset) {
		balArr.push(asset + ": " + totalBalances[asset].toFixed(8));
	});
	const totalBalancesString = balArr.join(', ');
	$('.totalBalances').html(totalBalancesString);

	//
	// TODO: use sourceBalanceTotals to compare the source file balances to the generated balances here
	//

	if (hashFileLineNumber == undefined) {
		$('.stepTwoStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: Could not find your information in the Merkle tree');
		return;
	} else {
		if (params.sentenceBalances && hashFileSentenceBalances !== params.sentenceBalances) {
			$('.stepTwoStatus')
				.removeClass("boldGreen")
				.addClass("boldRed")
				.html('Error: Your balances in your Proof Sentence do not match your balances in the Merkle proof file');
			return;
		}

		$('.stepTwoStatus')
			.addClass("boldGreen")
			.removeClass("boldRed")
			.html('Success! We found your proof sentence Hash in the Merkle proof file at line ' + hashFileLineNumber);
		$('.stepThreeUnlock').show();
	}
	$('.hashFileLineNumber').html('Line ' + hashFileLineNumber + ' in the Merkle Proof File');
	$('.userRewardCode').html(hashFileUserRewardCode);


	// construct Merkle Tree from the leaves extracted from the hash file
	const merkleTools = new MerkleTools();
	merkleTools.addLeaves(leaves, false);
	merkleTools.makeTree(false);

	// calculate the Merkle Tree Root Hash
	const merkleRoot = merkleTools.getMerkleRoot().toString('hex');
	$('.computedRootHash').html(merkleRoot);
	if (merkleRoot !== sourceRootHash) {
		$('.stepThreeStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: The Generated root hash does not match the source file root hash.');
		return;
	}

	// generate the Merkle Tree Proof and format it for display
	const userHashIndex = leaves.findIndex(hash => hash === userMerkleHash);
	let merkleToolsProof = merkleTools.getProof(userHashIndex);

	// create proof chain output  (maybe better as json?)
	let positionalProofHtml = '';
	for (let i = 0; i < merkleToolsProof.length; i++) {
		positionalProofHtml += (merkleToolsProof[i].right) ? 'right, ' + merkleToolsProof[i].right : 'left, ' + merkleToolsProof[i].left;
		positionalProofHtml += '<br/>';
	}
	$('.computedUserProof').html(positionalProofHtml);

	if (merkleTools.validateProof(merkleToolsProof, userMerkleHash, merkleRoot)) {
		$('.stepThreeStatus')
			.addClass("boldGreen")
			.removeClass("boldRed")
			.html('Success! We found your proof sentence hash and were able to prove the integrity of the Merkle tree!');
		$('.stepFourUnlock').show();
	} else {
		$('.stepThreeStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: Could not find your proof sentence hash in the Merkle tree.');
	}
}

/**
 * create the Merkle tree using exchange provided user data, tally the balances, and compute the root hash
 *
 * @method generateMerkleTree
 * @param {String} exchangeFileContent content of input file
 * @param {String} exchangeFileName name of input file
 * @return void
 */
function generateMerkleTree(exchangeFileContent, exchangeFileName) {
	if (!exchangeFileName || !exchangeFileContent) {
		$('.stepOneStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: Please choose a file with valid user balances');
		return;
	}

	const list = exchangeFileContent.split(/\r?\n/); // read hashes and balances from exchange generated input file
	const leaves = [];
	const userHashes = [];
	const balances = [];
	const rewardCodes = [];
	let totalBalances = {};
	let proofId = '';

	console.log('Number of lines in exchange file: ' + list.length);
	for (let i = 1; i < list.length; i++) {
		const row = list[i];
		if (row.startsWith('#')) continue;

		let data = row.split(CSV_DELIMITER);
		if (data.length !== 3) {
			if (i === 1) {
				data = row.split(':');
				if (data[1]) {
					proofId = data[1].trim();
					$('.fileProofDate').html(proofId);
				} else {
					alert('Invalid BlocPalX Source file.');
					return;
				}
			} else {
				console.log('Line ' + ( i + 1 ) + ' was empty or invalid.');
				continue;
			}
		} else if (data[0].trim() === 'proofSentenceHash') {
			continue;
		}

		if (data.length < 3) continue;

		let userHash = data[0].trim();
		let userBalances = data[1].trim();
		let userRewardCode = data[2].trim();

		if (userBalances !== 'none') {
			const balanceSplit = userBalances.split(':');
			for (let j = 0; j < balanceSplit.length; j++) {
				const balanceInfo = balanceSplit[j].trim().split(' ');
				const asset = balanceInfo[1].trim();
				totalBalances[asset] = (totalBalances[asset] || 0) + Number(balanceInfo[0].trim()); // calculate total balance
			}

			// concatenate the user proof sentence hash and the balances into a hash for the merkle tree
            let merkleHash = Sha256(userHash + ',' + userBalances).toString();

			leaves.push(merkleHash);
			userHashes.push(userHash);
			balances.push(userBalances);
			rewardCodes.push(userRewardCode);
		}

		if (i % 10000 === 0 && i > 0) {
			console.log("Checkpoint: Users: " + i + "; Balances: " + totalBalances.toString());
		}
	}

	console.log('Number of balances: ' + leaves.length);

	if (leaves.length > 0) {
		// construct Merkle Tree from the leaves extracted from the hash file
		const merkleTools = new MerkleTools();
		merkleTools.addLeaves(leaves, false);
		merkleTools.makeTree(false);

		// calculate the Merkle Tree Root Hash
		const merkleRoot = merkleTools.getMerkleRoot().toString('hex');

		// setup the file output
		let output = 'BlocPalX proof of reserves merkle tree file' + NEW_LINE;
		output += 'Proof id: ' + proofId + NEW_LINE;
		output += 'Root hash: ' + merkleRoot + NEW_LINE;

		let balArr=[];
		Object.keys(totalBalances).forEach(function(asset) {
			balArr.push(totalBalances[asset].toFixed(8) + ' ' + asset);
		});
		output += 'Balance totals: ' + balArr.join(',') + NEW_LINE;

		output += 'proofSentenceHash' + CSV_DELIMITER + 'proofBalanceString' + CSV_DELIMITER + 'proofRewardCode' + NEW_LINE;
		for (let i = 0; i < leaves.length; i++) {
			// write only the leaf nodes of the Merkle tree into verification file, all letters in lower case
			output +=
				userHashes[i] +
				CSV_DELIMITER +
				balances[i] +
				CSV_DELIMITER +
				rewardCodes[i] +
				NEW_LINE;
		}
		console.log('Merkle tree complete');

		// save the Merkle tree data as verification file
		let resultFileName = exchangeFileName.split('.')[0];
		resultFileName += '_merkletree.txt';
		let file = new File([output], resultFileName, { type: 'text/plain;charset=utf-8' });
		saveAs(file);

		$('.computedRootHash').html(merkleRoot);
		$('.userNums').html(merkleTools.getLeafCount());

		const totalBalancesString = balArr.join(', ');
		$('.totalBalances').html(totalBalancesString);

		$('.stepOneStatus')
			.addClass("boldGreen")
			.removeClass("boldRed")
			.html('Merkle tree created!');

	} else {
		$('.stepOneStatus')
			.removeClass("boldGreen")
			.addClass("boldRed")
			.html('Error: No hashes generated. Check exchange file.');
	}
}

