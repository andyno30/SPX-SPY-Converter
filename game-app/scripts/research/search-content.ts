import {loadCatalog} from './check-content.js';
const query=process.argv.slice(2).join(' ').trim().toLowerCase();
if(!query)throw new Error('Provide a name, Korean term or ID');
const c=loadCatalog(),all=[...c.main,...c.free,...c.records];
const matches=all.filter(r=>JSON.stringify([r.id,r.name,r.claims]).toLowerCase().includes(query));
for(const r of matches){
  const related=all.filter(other=>JSON.stringify(other.claims).includes(r.id)).map(x=>x.id);
  console.log(JSON.stringify({id:r.id,name:r.name,related,sourceNotes:r.sourceNotes},null,2));
}
console.log(`${matches.length} catalog matches. Developer CLI only; no public debug route.`);
