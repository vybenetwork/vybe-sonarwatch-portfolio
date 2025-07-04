import { NetworkId, TokenPriceSource } from '@sonarwatch/portfolio-core';
import { Cache } from '../../Cache';
import { Job, JobExecutor } from '../../Job';
import { platformId, programId } from './constants';
import { getClientSolana } from '../../utils/clients';
import { marketStruct } from './structs';
import { ParsedGpa } from '../../utils/solana/beets/ParsedGpa';
import { tokenAccountStruct } from '../../utils/solana';
import { getLpTokenSourceRaw } from '../../utils/misc/getLpTokenSourceRaw';
import { getCachedDecimalsForToken } from '../../utils/misc/getCachedDecimalsForToken';
import sleep from '../../utils/misc/sleep';
import { getParsedMultipleAccountsInfoSafe } from '../../utils/solana/getParsedMultipleAccountsInfoSafe';

const executor: JobExecutor = async (cache: Cache) => {
  const connection = getClientSolana();

  const markets = await ParsedGpa.build(connection, marketStruct, programId)
    .addFilter('accountDiscriminator', [241, 154, 109, 4, 17, 177, 109, 188])
    .run();

  if (!markets) throw new Error('No Markets found');

  await sleep(5000);

  const MARKETS_BATCH_SIZE = 100;

  const batchSources: TokenPriceSource[] = [];
  for (let offset = 0; offset < markets.length; offset += MARKETS_BATCH_SIZE) {
    const marketsBatch = markets.slice(offset, offset + MARKETS_BATCH_SIZE);

    const [tokenPrices, baseTokenAccounts, quoteTokenAccounts] =
      await Promise.all([
        cache.getTokenPricesAsMap(
          marketsBatch
            .map((market) => [
              market.base_mint.toString(),
              market.quote_mint.toString(),
            ])
            .flat(),
          NetworkId.solana
        ),
        getParsedMultipleAccountsInfoSafe(
          connection,
          tokenAccountStruct,
          tokenAccountStruct.byteSize,
          marketsBatch.map((market) => market.pool_base_token_account)
        ),
        getParsedMultipleAccountsInfoSafe(
          connection,
          tokenAccountStruct,
          tokenAccountStruct.byteSize,
          marketsBatch.map((market) => market.pool_quote_token_account)
        ),
      ]);

    const [baseDecimals, quoteDecimals] = await Promise.all([
      Promise.all(
        marketsBatch.map((market) => {
          const tokenPrice = tokenPrices.get(market.base_mint.toString());
          return (
            tokenPrice?.decimals ||
            getCachedDecimalsForToken(
              cache,
              market.base_mint.toString(),
              NetworkId.solana
            )
          );
        })
      ),
      Promise.all(
        marketsBatch.map((market) => {
          const tokenPrice = tokenPrices.get(market.quote_mint.toString());
          return (
            tokenPrice?.decimals ||
            getCachedDecimalsForToken(
              cache,
              market.quote_mint.toString(),
              NetworkId.solana
            )
          );
        })
      ),
    ]);

    marketsBatch.forEach((market, i) => {
      const baseTokenAccount = baseTokenAccounts[i];
      const quoteTokenAccount = quoteTokenAccounts[i];

      if (!baseTokenAccount || !quoteTokenAccount) return;
      const baseTokenPrice = tokenPrices.get(market.base_mint.toString());
      const quoteTokenPrice = tokenPrices.get(market.quote_mint.toString());

      const lpDecimal = 9;
      const baseTokenDecimal = baseDecimals[i];
      const quoteTokenDecimal = quoteDecimals[i];
      if (!lpDecimal || !baseTokenDecimal || !quoteTokenDecimal) return;

      const lpSources = getLpTokenSourceRaw({
        lpDetails: {
          address: market.lp_mint.toString(),
          decimals: lpDecimal,
          supplyRaw: market.lp_supply,
        },
        platformId,
        sourceId: market.pubkey.toString(),
        networkId: NetworkId.solana,
        poolUnderlyingsRaw: [
          {
            address: market.base_mint.toString(),
            decimals: baseTokenDecimal,
            reserveAmountRaw: baseTokenAccount.amount,
            tokenPrice: baseTokenPrice,
          },
          {
            address: market.quote_mint.toString(),
            decimals: quoteTokenDecimal,
            reserveAmountRaw: quoteTokenAccount.amount,
            tokenPrice: quoteTokenPrice,
          },
        ],
        priceUnderlyings: true,
        link: `https://swap.pump.fun/deposit?pool=${market.pubkey}`,
        sourceRefs: [{ address: market.pubkey.toString(), name: 'Pool' }],
      });

      batchSources.push(...lpSources);
    });
  }
  await cache.setTokenPriceSources(batchSources);
};

const job: Job = {
  id: `${platformId}-markets`,
  executor,
  labels: [NetworkId.solana, 'slow', 'manual'],
};
export default job;
