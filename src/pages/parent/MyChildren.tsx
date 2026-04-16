import React, { useState } from 'react';
import { useParentContext } from '../../context/ParentDataContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import {
  Users, GraduationCap, Phone, Calendar, AlertTriangle,
  Heart, School, ChevronDown, ChevronUp, Edit3, Save, X,
} from 'lucide-react';

const MyChildren: React.FC = () => {
  const { loading, students, bookings } = useParentContext();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse h-40" />
        ))}
      </div>
    );
  }

  const studentList = Object.values(students);

  const startEdit = (sid: string) => {
    const s = students[sid];
    setEditingId(sid);
    setEditForm({
      phone: s.phone || '',
      allergies: s.allergies || '',
      medicalNotes: s.medicalNotes || '',
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'students', editingId), {
        phone: editForm.phone || '',
        allergies: editForm.allergies || '',
        medicalNotes: editForm.medicalNotes || '',
      });
      toast.success('Student info updated');
      setEditingId(null);
      setEditForm({});
    } catch {
      toast.error('Failed to update. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Determine age display
  const ageFromDob = (dob: string) => {
    if (!dob) return '';
    const birth = new Date(dob);
    const diff = Date.now() - birth.getTime();
    const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    return `${age} years old`;
  };

  // Find which bookings a student is in
  const getStudentBookings = (sid: string) => bookings.filter(b => b.studentIds.includes(sid));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Children</h1>
          <p className="text-slate-500 text-sm mt-1">{studentList.length} student{studentList.length !== 1 ? 's' : ''} registered</p>
        </div>
      </div>

      {studentList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Users size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-500 font-medium">No students found</p>
          <p className="text-slate-400 text-sm mt-1">Students will appear here once you submit an application.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {studentList.map(s => {
            const isExpanded = expandedId === s.id;
            const isEditing = editingId === s.id;
            const sBookings = getStudentBookings(s.id);
            const initials = s.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

            return (
              <div key={s.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Header row */}
                <div
                  className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : s.id)}
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800">{s.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1"><GraduationCap size={11} /> Grade {s.grade}</span>
                      <span className="flex items-center gap-1"><School size={11} /> {s.schoolName}</span>
                      {s.dob && <span className="flex items-center gap-1"><Calendar size={11} /> {ageFromDob(s.dob)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {sBookings.some(b => b.status === 'active') && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">Active</span>
                    )}
                    {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <InfoRow icon={School} label="School" value={s.schoolName} />
                      <InfoRow icon={Phone} label="School Contact" value={s.schoolContact || '—'} />
                      <InfoRow icon={GraduationCap} label="Grade" value={s.grade} />
                      <InfoRow icon={Calendar} label="Date of Birth" value={s.dob || '—'} />
                      <InfoRow icon={Phone} label="Student Phone" value={isEditing ? undefined : (s.phone || '—')} />
                    </div>

                    {/* Medical */}
                    <div className="bg-red-50 rounded-xl px-4 py-3 space-y-2">
                      <div className="text-xs font-semibold text-red-700 uppercase tracking-wide flex items-center gap-1.5">
                        <Heart size={12} /> Medical Information
                      </div>
                      {isEditing ? (
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">Phone</label>
                            <input
                              value={editForm.phone}
                              onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">Allergies</label>
                            <input
                              value={editForm.allergies}
                              onChange={e => setEditForm(p => ({ ...p, allergies: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">Medical Notes</label>
                            <textarea
                              value={editForm.medicalNotes}
                              onChange={e => setEditForm(p => ({ ...p, medicalNotes: e.target.value }))}
                              rows={2}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                            >
                              <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 transition"
                            >
                              <X size={13} /> Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <span className="text-xs text-red-600 font-medium">Allergies:</span>
                              <span className="text-xs text-slate-700 ml-1">{s.allergies || 'None reported'}</span>
                            </div>
                            <div>
                              <span className="text-xs text-red-600 font-medium">Medical Notes:</span>
                              <span className="text-xs text-slate-700 ml-1">{s.medicalNotes || 'None'}</span>
                            </div>
                          </div>
                          {s.allergies && s.allergies.toLowerCase() !== 'none' && (
                            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
                              <AlertTriangle size={12} /> Allergy info is shared with driver
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Services */}
                    {sBookings.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Transportation Services</div>
                        {sBookings.map(b => (
                          <div key={b.id} className="flex items-center gap-3 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-1.5">
                            <span className={`w-2 h-2 rounded-full ${b.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span>{b.pickupAddress?.split(',')[0]} → {b.dropoffAddress?.split(',')[0]}</span>
                            <span className="ml-auto font-medium capitalize">{b.status.replace('_', ' ')}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Edit button */}
                    {!isEditing && (
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(s.id); }}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition"
                      >
                        <Edit3 size={13} /> Edit Medical & Contact Info
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-slate-400 flex-shrink-0" />
      <span className="text-xs text-slate-500">{label}:</span>
      <span className="text-xs text-slate-800 font-medium">{value}</span>
    </div>
  );
}

export default MyChildren;
