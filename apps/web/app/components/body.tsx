import { BurstsCard } from './bursts';
import { EditsPerMinuteChart } from './editsPerMinute';
import { BurstsSizeCard } from './topCards/burstsSize';
import { BusiestWikipediaCard } from './topCards/busiestWiki';
import { EditsPerMinuteCard } from './topCards/editsInMin';
import { HumansVSBotsCard } from './topCards/humansVsBots';

export function Body() {
  return (
    <div>
      <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-5">
        <EditsPerMinuteCard />
        <HumansVSBotsCard />
        <BurstsSizeCard />
        <BusiestWikipediaCard />
      </div>
      <div className="grid w-full gap-4 xl:grid-cols-3">
        <EditsPerMinuteChart />
        <BurstsCard/>
      </div>
    </div>
  );
}
