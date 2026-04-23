/**
 * Calculate a person's age in whole years from their date of birth.
 * Accepts an ISO date string ("YYYY-MM-DD"), a Date object, or a Firestore
 * Timestamp duck-typed value (anything with a `.toDate()` method).
 *
 * Returns NaN when the input is empty or unparseable so the caller can
 * decide how to display it (e.g. show "—").
 */
export function calculateAge(dateOfBirth: string | Date | null | undefined | { toDate: () => Date }): number {
  if (!dateOfBirth) return NaN;

  let dob: Date;
  if (typeof dateOfBirth === 'string') {
    if (!dateOfBirth.trim()) return NaN;
    dob = new Date(dateOfBirth);
  } else if (dateOfBirth instanceof Date) {
    dob = dateOfBirth;
  } else if (typeof (dateOfBirth as { toDate?: () => Date }).toDate === 'function') {
    dob = (dateOfBirth as { toDate: () => Date }).toDate();
  } else {
    return NaN;
  }

  if (isNaN(dob.getTime())) return NaN;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age < 0 ? NaN : age;
}
