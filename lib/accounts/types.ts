export interface DailyAccountRecord {
  id: string;
  location_id: string;
  business_date: string; // YYYY-MM-DD
  
  // Night Shift details
  night_upi: number;
  night_cash: number;
  night_total_earnings: number; // upi + cash
  night_opening_balance: number;
  night_expenses: number;
  night_closing_balance: number;
  night_expected_closing: number; // opening + cash - expenses
  night_difference: number; // closing - expected
  night_is_tallied: boolean; // difference === 0
  night_notes?: string | null;
  night_submitted_by?: string | null;
  night_submitted_by_name?: string | null;
  night_submitted_at?: string | null;
  
  // Day Shift handover details
  day_opening_balance?: number | null;
  day_difference?: number | null; // day_opening_balance - night_closing_balance
  day_is_tallied?: boolean | null; // day_difference === 0
  day_notes?: string | null;
  day_submitted_by?: string | null;
  day_submitted_by_name?: string | null;
  day_submitted_at?: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface DayShiftComparison {
  previous_business_date: string;
  previous_night_closing: number;
  day_opening_balance: number;
  difference: number;
  is_tallied: boolean;
}
