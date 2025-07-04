import { NetworkId, solanaNativeAddress } from '@sonarwatch/portfolio-core';
import { PublicKey } from '@solana/web3.js';
import { Cache } from '../../Cache';
import {
  amountPerBasicEdition,
  amountPerMasterEdition,
  platformId,
} from './constants';
import { Fetcher, FetcherExecutor } from '../../Fetcher';
import { ElementRegistry } from '../../utils/elementbuilder/ElementRegistry';
import { getClientSolana } from '../../utils/clients';
import { getEditionPubkeyOfNft, getMetadataPubkey } from './helpers';
import { getMultipleAccountsInfoSafe } from '../../utils/solana/getMultipleAccountsInfoSafe';
import { getTokenAccountsByOwner } from '../../utils/solana/getTokenAccountsByOwner';
import { ParsedAccount, TokenAccount } from '../../utils/solana';

const resizeExpiration = 1755426940000;

export const getResizableNfts = async (
  tokenAccounts: ParsedAccount<TokenAccount>[],
  cache: Cache
) => {
  if (Date.now() > resizeExpiration) return [];
  const client = getClientSolana();

  const metadataPubkeys: PublicKey[] = [];
  const editionPubkeys: PublicKey[] = [];
  tokenAccounts.forEach((account) => {
    metadataPubkeys.push(getMetadataPubkey(account.mint));
    editionPubkeys.push(getEditionPubkeyOfNft(account.mint));
  });

  const [editionAccounts, metadataAccounts] = await Promise.all([
    getMultipleAccountsInfoSafe(client, editionPubkeys),
    getMultipleAccountsInfoSafe(client, metadataPubkeys),
  ]);

  let amount = 0;
  let editionAccount;
  for (let n = 0; n < metadataAccounts.length; n++) {
    if (!metadataAccounts[n]) continue;

    editionAccount = editionAccounts[n];
    if (!editionAccount) continue;

    if (metadataAccounts[n]?.data.byteLength === 679) {
      if (editionAccount.data.byteLength === 282) {
        amount += amountPerMasterEdition;
      }
      if (editionAccount.data.byteLength === 241) {
        amount += amountPerBasicEdition;
      }
    }
  }

  const elementRegistry = new ElementRegistry(NetworkId.solana, platformId);
  const element = elementRegistry.addElementMultiple({
    label: 'Rewards',
    name: 'Resize Program',
    link: 'https://resize.metaplex.com',
  });

  element.addAsset({
    address: solanaNativeAddress,
    amount,
    alreadyShifted: true,
    attributes: {
      isClaimable: true,
    },
  });

  return elementRegistry.getElements(cache);
};

const executor: FetcherExecutor = async (owner: string, cache: Cache) => {
  const tokenAccounts = await getTokenAccountsByOwner(getClientSolana(), owner);
  return getResizableNfts(tokenAccounts, cache);
};

const fetcher: Fetcher = {
  id: `${platformId}-resize`,
  networkId: NetworkId.solana,
  executor,
};

export default fetcher;
