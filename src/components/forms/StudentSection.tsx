import React from 'react';

export interface StudentSectionProps {
  index: number;
  value: StudentForm;
  onChange: (index: number, value: StudentForm) => void;
  errors?: Partial<Record<keyof StudentForm, string>>;
}

export interface StudentForm {
  fullName: string;
  dob: string;
  age: number;
  grade: string;
  schoolName: string;
  schoolContact: string;
  phone?: string;
}

const StudentSection: React.FC<StudentSectionProps> = ({ index, value, onChange, errors }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value: val } = e.target;
    let newValue = { ...value, [name]: val };
    if (name === 'dob') {
      const birthDate = new Date(val);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      newValue.age = isNaN(age) ? 0 : age;
    }
    onChange(index, newValue);
  };

  const inputCls = 'w-full rounded-lg border border-kidz-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-kidz-blue focus:border-transparent transition';
  const labelCls = 'text-sm font-medium text-kidz-textPrimary mb-1 block';
  const errCls = 'text-red-500 text-xs mt-1';

  return (
    <div className="bg-kidz-surface rounded-xl border border-kidz-border p-5 mb-4">
      <h3 className="font-bold text-lg mb-3 text-kidz-navy">Student {index + 1}</h3>
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Full Name</label>
          <input type="text" name="fullName" value={value.fullName} onChange={handleChange} className={inputCls} />
          {errors?.fullName && <span className={errCls}>{errors.fullName}</span>}
        </div>
        <div>
          <label className={labelCls}>Date of Birth</label>
          <input type="date" name="dob" value={value.dob} onChange={handleChange} className={inputCls} />
          {errors?.dob && <span className={errCls}>{errors.dob}</span>}
        </div>
        <div>
          <label className={labelCls}>Age</label>
          <input type="number" name="age" value={value.age} readOnly className={`${inputCls} bg-kidz-gray text-kidz-textMuted`} />
          {errors?.age && <span className={errCls}>{errors.age}</span>}
        </div>
        <div>
          <label className={labelCls}>Grade</label>
          <input type="text" name="grade" value={value.grade} onChange={handleChange} className={inputCls} />
          {errors?.grade && <span className={errCls}>{errors.grade}</span>}
        </div>
        <div>
          <label className={labelCls}>School Name</label>
          <input type="text" name="schoolName" value={value.schoolName} onChange={handleChange} className={inputCls} />
          {errors?.schoolName && <span className={errCls}>{errors.schoolName}</span>}
        </div>
        <div>
          <label className={labelCls}>School Point of Contact</label>
          <input type="text" name="schoolContact" value={value.schoolContact} onChange={handleChange} className={inputCls} />
          {errors?.schoolContact && <span className={errCls}>{errors.schoolContact}</span>}
        </div>
        <div>
          <label className={labelCls}>Student Phone <span className="text-kidz-textMuted font-normal">(optional)</span></label>
          <input type="tel" name="phone" value={value.phone || ''} onChange={handleChange} className={inputCls} />
          {errors?.phone && <span className={errCls}>{errors.phone}</span>}
        </div>
      </div>
    </div>
  );
};

export default StudentSection;