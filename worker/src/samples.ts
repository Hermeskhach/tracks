export async function addExamples(db:D1Database,userId:string,today:string) {
  const definitions=[
    ['German','A little closer to fluent, every day.','🇩🇪','green','Practiced articles and sentence structure',25,'min','Worked on der, die, das. The patterns are starting to stick.'],
    ['Running','Fresh air. Clear head. One kilometer at a time.','↗','blue','An easy run around the neighborhood',3,'km','15:42 · Moderate-hard effort. Felt good to get outside.'],
    ['Web Agency','Building a thoughtful, independent business.','▧','purple','Refined the agency positioning',45,'min','Narrowed down the services and prepared networking follow-ups.'],
    ['Reading','Good books, new perspectives.','▤','orange','Read a few chapters',30,'pages','Made a note of a passage to come back to.'],
    ['Boxing','Showing up, getting stronger.','✳','pink','Footwork and bag training',60,'min','Focused on keeping my guard up between combinations.']
  ];
  const statements:D1PreparedStatement[]=[];const time=new Date().toISOString();
  for(const [n,d] of definitions.entries()) {
    const id=crypto.randomUUID();statements.push(db.prepare('INSERT INTO tracks(id,userId,name,description,icon,color,createdAt) VALUES(?,?,?,?,?,?,?)').bind(id,userId,d[0],d[1],d[2],d[3],time));
    // Modest sample size keeps the explicit onboarding action inside D1 Free query limits.
    let entries=0;
    for(let day=0;day<42 && entries<7;day++) {
      if(day===0&&n>2 || day>3&&(day*13+n*17)%23>8-n)continue;
      entries++;
      const date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-day);
      statements.push(db.prepare('INSERT INTO activities(id,projectId,date,title,description,value,unit,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,date.toISOString().slice(0,10),d[4],day===0?d[7]:'Example activity — edit or delete to make this journal your own.',d[5],d[6],time,time));
    }
  }
  // Atomic D1 transaction with at most 40 statements and at most 9 parameters each.
  await db.batch(statements);
}
