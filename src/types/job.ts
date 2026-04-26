export interface ScrapedJobType {
  id?: string;
  title: string;
  url: string;
  desc: string;
  category: string;
  price: string;
  suggestions: string;
  daysLeft: string;
  deadline: string;
  postedDate: string;
  employer: string;
  employerUrl: string;
  employerAvatar: string;
  tags?: string[];
  workType?: string;
}

interface JobType {
  id: string;
  bidPlaced: boolean;
  /** Snapshot from first scrape; used for manual / callback bidding. */
  lastSnapshot?: Partial<ScrapedJobType> & { id?: string };
}

export default JobType;
