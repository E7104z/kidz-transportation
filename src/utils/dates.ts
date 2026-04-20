/** Safely convert Firestore Timestamp / Date / string / number to a JS Date. */
export const toDate = (val: unknown): Date => {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function')
    return (val as { toDate: () => Date }).toDate();
  return new Date(val as string | number);
};

/** Full day names indexed by JS getDay() (0 = Sunday). */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Two-letter abbreviations indexed by JS getDay(). */
export const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Single/two-char weekday labels (Mon–Fri only). */
export const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F'] as const;

/** Three-letter weekday keys matching booking.daysOfWeek values (Mon–Fri). */
export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
