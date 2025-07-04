import { NetworkId } from '@sonarwatch/portfolio-core';
import { Cache } from '../../../Cache';
import { Job, JobExecutor } from '../../../Job';
import { getClientSolana } from '../../../utils/clients';
import { dbcProgramId, platformId } from '../constants';
import { virtualPoolStruct } from './structs';
import { setJupiterPrices } from '../../jupiter/pricing/setJupiterPrices';

const executor: JobExecutor = async (cache: Cache) => {
  const client = getClientSolana();

  const accounts = await client.getProgramAccounts(dbcProgramId, {
    filters: [{ memcmp: { offset: 0, bytes: 'cmrfVvtHrjd' } }],
    dataSlice: { offset: 0, length: 168 },
  });

  const mintsPk = accounts.map((account) => {
    const virtualPool = virtualPoolStruct.deserialize(account.account.data)[0];
    return virtualPool.base_mint.toString();
  });

  await setJupiterPrices(mintsPk, cache);
};

const job: Job = {
  id: `${platformId}-dbc-pricing`,
  executor,
  labels: [NetworkId.solana, 'manual'],
};
export default job;
