import { z } from 'zod';
export const siteSchema=z.object({id:z.string().min(1).max(80),name:z.string().min(1).max(120),district:z.string().min(1).max(80),ecosystem:z.enum(['Forest','Wetland','Grassland','Riverbank','Coastal']),latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180),area_ha:z.coerce.number().positive().max(1000000),vegetation_pct:z.coerce.number().min(0).max(100),soil_health:z.coerce.number().min(0).max(100),water_stress:z.coerce.number().min(0).max(100),biodiversity:z.coerce.number().min(0).max(100),erosion_risk:z.coerce.number().min(0).max(100),observed_at:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Invalid date')});
export type Site=z.infer<typeof siteSchema>;
export type Weights={vegetation:number;soil:number;water:number;biodiversity:number;erosion:number};
export const defaults:Weights={vegetation:30,soil:20,water:15,biodiversity:15,erosion:20};
export const weightsSchema=z.object({vegetation:z.number().min(0).max(100),soil:z.number().min(0).max(100),water:z.number().min(0).max(100),biodiversity:z.number().min(0).max(100),erosion:z.number().min(0).max(100)}).refine(w=>Object.values(w).reduce((a,b)=>a+b,0)>0,'Set at least one positive weight');
export function isCsvFile(file:{name:string;type:string}){
 const name=file.name.toLowerCase();
 const type=file.type.toLowerCase();
 return name.endsWith('.csv') || type === 'text/csv' || type === 'application/csv';
}
export function analyze(s:Site,w:Weights=defaults){
 const total=Object.values(w).reduce((a,b)=>a+b,0);if(!total)throw new Error('At least one weight must be positive');
 const factors={vegetation:100-s.vegetation_pct,soil:100-s.soil_health,water:s.water_stress,biodiversity:100-s.biodiversity,erosion:s.erosion_risk};
 const breakdown=Object.entries(factors).map(([key,value])=>({key,value,contribution:value*w[key as keyof Weights]/total}));
 const score=Math.round(breakdown.reduce((a,b)=>a+b.contribution,0));
 const action=s.ecosystem==='Wetland'?'Restore wetland hydrology':s.ecosystem==='Coastal'?'Assess coastal habitat recovery':s.erosion_risk>=65?'Stabilize soil and restore ground cover':s.ecosystem==='Grassland'?'Restore native grassland':s.ecosystem==='Riverbank'?'Restore riparian vegetation':'Assist native regeneration';
 const rate=s.ecosystem==='Wetland'?65000:s.ecosystem==='Coastal'?85000:s.ecosystem==='Grassland'?25000:45000;
 return {...s,score,priority:score>=65?'High':score>=40?'Moderate':'Low',action,cost:Math.round(s.area_ha*rate),breakdown};
}
export type Ranked=ReturnType<typeof analyze>;
export type Plan={id:string;siteId:string;siteName:string;action:string;cost:number;status:'Proposed'|'In progress'|'Completed';due:string;notes:string;created:string};
export type Observation={id:string;siteId:string;date:string;vegetation:number;survival:number;notes:string};
export type Workspace={sites:Site[];name:string;source:string;weights:Weights;plans:Plan[];observations:Observation[]};
const rows:[string,string,string,Site['ecosystem'],number,number,number,number,number,number,number,number][]=[
 ['TN-001','Pachamalai foothills','Perambalur','Forest',11.28,78.65,24,22,32,72,30,84],['TN-002','Cauvery riparian belt','Karur','Riverbank',10.96,78.12,18,35,40,63,38,76],['TN-003','Vellode wetland edge','Erode','Wetland',11.26,77.66,32,43,48,70,45,38],['TN-004','Sirumalai buffer','Dindigul','Forest',10.21,77.99,45,51,52,42,55,61],['TN-005','Pallikaranai fringe','Chennai','Wetland',12.94,80.21,16,20,29,81,24,45],['TN-006','Point Calimere buffer','Nagapattinam','Coastal',10.30,79.82,28,49,46,62,57,55],['TN-007','Kolli hills clearing','Namakkal','Grassland',11.25,78.34,12,62,60,35,58,40],['TN-008','Vaigai river stretch','Madurai','Riverbank',9.93,78.13,22,28,36,78,33,72],['TN-009','Sathyamangalam buffer','Erode','Forest',11.51,77.25,54,74,71,26,72,23],['TN-010','Yercaud grassland','Salem','Grassland',11.78,78.21,15,67,64,30,61,31],['TN-011','Pichavaram fringe','Cuddalore','Coastal',11.43,79.77,36,56,58,43,64,44],['TN-012','Amaravathi catchment','Tiruppur','Riverbank',10.42,77.26,20,39,44,66,40,68]];
export const sampleSites:Site[]=rows.map(([id,name,district,ecosystem,latitude,longitude,area_ha,vegetation_pct,soil_health,water_stress,biodiversity,erosion_risk])=>({id,name,district,ecosystem,latitude,longitude,area_ha,vegetation_pct,soil_health,water_stress,biodiversity,erosion_risk,observed_at:'2026-09-20'}));
export const initialWorkspace:Workspace={sites:sampleSites,name:'Tamil Nadu · demonstration survey',source:'Synthetic sample — not field measurements',weights:defaults,plans:[],observations:[]};
export const columns=Object.keys(sampleSites[0]);
export function validateRows(rows:unknown[]){if(rows.length===0||rows.length>5000)throw new Error('Upload 1–5,000 rows.');const ids=new Set();return rows.map((row,i)=>{const raw=row as Record<string,unknown>;for(const k of columns){if(raw[k]===undefined||raw[k]===null||String(raw[k]).trim()==='')throw new Error(`Row ${i+2}: ${k} is required.`);}const parsed=siteSchema.safeParse(raw);if(!parsed.success)throw new Error(`Row ${i+2}: ${parsed.error.issues.map(x=>x.path.join('.')+' '+x.message).join('; ')}`);if(ids.has(parsed.data.id))throw new Error(`Row ${i+2}: duplicate id ${parsed.data.id}`);ids.add(parsed.data.id);return parsed.data;});}
export function budgetSelection(rows:Ranked[],budget:number){let spent=0;const selected:Ranked[]=[];for(const s of [...rows].sort((a,b)=>b.score-a.score)){if(spent+s.cost<=budget){selected.push(s);spent+=s.cost;}}return {selected,spent};}
