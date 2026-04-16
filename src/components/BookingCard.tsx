import { useDraggable } from '@dnd-kit/core';
import { formatDistanceToNow } from 'date-fns';
import { School } from 'lucide-react';

const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F'];
const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function formatCurrency(n: number) {
  return n ? `$${n.toFixed(2)}/wk` : '--';
}

const BookingCard = ({ booking, onSelect }: {
  booking: any;
  onSelect: () => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: booking.id });
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`
  } : undefined;

  const studentNames = booking.students.map((s: any) => s?.name).filter(Boolean).join(', ');
  const parentName = booking.client?.name || '';
  const parentPhone = booking.client?.phone || '';
  const schoolName = booking.students[0]?.schoolName || '';
  const days = booking.daysOfWeek || [];
  const createdAt = booking.createdAt instanceof Date ? booking.createdAt : (booking.createdAt?.toDate ? booking.createdAt.toDate() : new Date(booking.createdAt));

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={`bg-white rounded-xl border border-kidz-border shadow-sm p-4 cursor-grab hover:shadow-md hover:border-kidz-blue transition-all duration-200 ${isDragging ? 'opacity-60' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        onSelect();
      }}
    >
      <div className="font-semibold text-kidz-textPrimary text-sm truncate max-w-[140px]">
        {studentNames || '—'}
      </div>
      <div className="text-xs text-kidz-textSecondary mt-1">
        {parentName}
        {parentPhone && (
          <a
            href={`tel:${parentPhone}`}
            className="text-kidz-blue hover:underline ml-1"
            onClick={(e) => e.stopPropagation()}
          >
            {parentPhone}
          </a>
        )}
      </div>
      <div className="text-xs text-kidz-textMuted flex items-center gap-1 mt-1">
        <School size={12} />
        {schoolName}
      </div>
      <div className="flex justify-between items-center mt-2">
        <div className="flex gap-1">
          {DAY_LABELS.map((label, i) => (
            <span
              key={label}
              className={`text-xs rounded-full px-1.5 py-0.5 font-medium ${
                days.includes(DAY_KEYS[i])
                  ? 'bg-kidz-blueLight text-kidz-blue'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="text-kidz-amber font-bold text-sm">
          {formatCurrency(booking.weeklyRate)}
        </span>
      </div>
      <span
        className={`rounded-full text-xs font-medium px-2 py-0.5 mt-2 inline-block ${
          booking.transportationType === 'roundtrip'
            ? 'bg-blue-100 text-blue-700'
            : booking.transportationType === 'am_only'
            ? 'bg-amber-100 text-amber-700'
            : booking.transportationType === 'pm_only'
            ? 'bg-purple-100 text-purple-700'
            : booking.transportationType === 'midday'
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        {booking.transportationType === 'roundtrip'
          ? 'Roundtrip'
          : booking.transportationType === 'am_only'
          ? 'AM Only'
          : booking.transportationType === 'pm_only'
          ? 'PM Only'
          : booking.transportationType === 'midday'
          ? 'Midday'
          : booking.transportationType}
      </span>
      <div className="text-xs text-kidz-textMuted mt-2 text-right">
        {formatDistanceToNow(createdAt, { addSuffix: true })}
      </div>
    </div>
  );
};

export default BookingCard;
