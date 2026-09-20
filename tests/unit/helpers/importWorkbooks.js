// Synthetic workbooks for the importer tests — fictional people and numbers only.
import ExcelJS from 'exceljs';

const MIS_HEADERS = ['Sr No', 'Tower', 'Tower', 'Unit no', 'Floor No. from Ground', 'Habitable Floor', 'Customer Name (Main Applicant)', 'BOOKING STATUS', 'CP/ Direct/ MGMT', 'CP / MGMT Name', 'CP Firm Name',
  'Brokerage %', 'Closing Manager', 'Sourcing Manager', 'Booking Date', 'Token Amount', 'Area in SqFt', 'Agreement Value PSF', 'All-in Value PSF', 'Agreement Value in Rs.', 'All-in Value in Rs.', 'Typology',
  'Contact No. (Spokes Person)', 'PAN Card', 'Aadhar Card'];

const misRow = (o) => [o.sr, 'T1', 'Alpha Tower', o.unit, o.floor, o.floor - 1, o.cust || null, o.status, o.kind || null, o.agent || null, o.firm || null, o.brok ?? null, o.closing || null, o.sourcing || null,
  o.date || null, o.token ?? null, o.area, o.psf ?? null, o.psf ? o.psf * 1.1 : null, o.psf ? o.psf * o.area : null, o.psf ? o.psf * o.area * 1.1 : null, o.typ ?? 4, o.phone ?? null, o.pan || null, o.aadhaar || null];

export async function misWorkbook() {
  const wb = new ExcelJS.Workbook();
  const mis = wb.addWorksheet('MIS');
  mis.addRow(['Sales MIS']); mis.addRow(MIS_HEADERS);
  [
    { sr: 1, unit: 101, floor: 1, cust: 'Mr. Rahul Verma (Amit ref)', status: 'Sold', kind: 'CP', agent: 'Agent A', firm: 'Acme Realtors', brok: 2, closing: 'Meera Shah', sourcing: 'Kabir Rao', date: new Date('2024-05-10'), token: 500000, area: 1000, psf: 30000, phone: 9876543210, pan: 'ABCDE1234F', aadhaar: '1234 5678 9012' },
    { sr: 2, unit: 102, floor: 1, cust: 'Skyline Holdings Pvt Ltd', status: 'Registered', kind: 'Direct', closing: 'Meera Shah', date: new Date('2024-06-01'), area: 1200, psf: 32000 },
    { sr: 3, unit: '201 & 202', floor: 2, cust: 'Anita Desai', status: 'EOI', kind: 'MGMT', agent: 'Chairman', closing: 'Meera Shah', date: new Date('2025-01-15'), token: 1000000, area: 2300, psf: 31000, typ: 9 },
    { sr: 4, unit: 301, floor: 3, status: 'Unsold', area: 1000 },
    { sr: 5, unit: 'LMR', floor: 40, status: 'Unsold', area: 0 },
  ].forEach((o) => mis.addRow(misRow(o)));

  const mt = wb.addWorksheet('Client Meetings');
  mt.addRow(['Name', 'Status', 'Profile', 'Date of Visit', 'Type of Meeting', 'Address', 'Remarks', 'Source', 'Sales Manager', 'Sourcing Team', 'Project Name', 'Attended By']);
  mt.addRow(['Rahul Verma', 'Booked', 'Entrepreneur', new Date('2024-04-20'), 'IBM', 'Site office', 'Liked the sea view', 'Acme Realtors', 'Meera Shah', 'Kabir Rao', 'Alpha', '']);
  mt.addRow(['Vikram Nanda', 'Hot', 'Doctor', new Date('2024-07-02'), 'VC', '', 'Wants a higher floor', 'Direct', 'Meera Shah', '', 'Alpha', '']);
  mt.addRow(['Vikram Nanda', 'Revisit', 'Doctor', new Date('2024-07-20'), 'OBM', 'Client office', 'Second discussion', 'Direct', 'Meera Shah', '', 'Alpha', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function stackingWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stacking');
  ws.getCell('A1').value = 'Tower 1';
  ws.getCell('B3').value = 'North'; ws.getCell('C3').value = 'South';
  ws.getCell('A4').value = 'Floor from G'; ws.getCell('B4').value = 'UNIT 1'; ws.getCell('C4').value = 'UNIT 2';
  ws.getCell('B6').value = '4 BHK'; ws.getCell('C6').value = '5 BHK';
  const floors = [[3, 1000, 1200], [2, 1150, 1150], [1, 1000, 1200]];
  floors.forEach(([f, a, b], i) => { const r = 7 + i; ws.getCell(`A${r}`).value = f; ws.getCell(`B${r}`).value = a; ws.getCell(`C${r}`).value = b; });
  ws.getCell('B9').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } }; // floor 1, unit 1 → committed
  return Buffer.from(await wb.xlsx.writeBuffer());
}
