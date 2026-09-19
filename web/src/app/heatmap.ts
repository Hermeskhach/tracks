import { Component, computed, input, output } from '@angular/core';
import { Activity, addDays, dateKey } from './journal';
@Component({
  selector: 'app-heatmap', standalone: true,
  template: `
    <div class="heatmap-scroll" [class.compact]="compact()">
      <div class="heatmap" [style.--weeks]="weeks()">
        <div class="month-labels">@for (month of months(); track month.column) { <span [style.grid-column]="month.column">{{ month.label }}</span> }</div>
        <div class="day-labels"><span>Mon</span><span>Wed</span><span>Fri</span></div>
        <div class="cells">@for (day of days(); track day.date) {
          <button type="button" class="cell level-{{day.level}}" [class.outside]="day.outside" [class.selected]="selected() === day.date"
            [disabled]="day.outside || day.date > today" [attr.aria-label]="day.label" [title]="day.label" (click)="pick.emit(day.date)"></button>
        }</div>
      </div>
    </div>
    @if (!compact()) { <div class="heatmap-foot"><span>Each square is a day. Select one to see the story.</span><div class="legend">Less <i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i> More</div></div> }
  `,
})
export class Heatmap {
  activities = input<Activity[]>([]); year = input(new Date().getFullYear()); compact = input(false); selected = input(''); pick = output<string>();
  today = dateKey(new Date());
  days = computed(() => {
    const compact = this.compact(); const end = compact ? this.today : `${this.year()}-12-31`;
    let start = compact ? addDays(end,-139) : `${this.year()}-01-01`;
    const boundary = start;
    start = addDays(start, -((new Date(start+'T12:00:00').getDay()+6)%7));
    const counts = new Map<string,number>(); for (const a of this.activities()) counts.set(a.date,(counts.get(a.date)||0)+1);
    const result = []; let day = start;
    while (day <= end || result.length%7 !== 0) {
      const count = counts.get(day)||0;
      result.push({date:day, level:Math.min(count,4), outside:day < boundary || day > end, label:`${day}: ${count} ${count===1?'activity':'activities'}`});
      day = addDays(day,1);
    }
    return result;
  });
  weeks = computed(() => this.days().length / 7);
  months = computed(() => {
    let previous = ''; const result: {column:number;label:string}[] = [];
    this.days().forEach((d,i) => { if (i%7===0 && !d.outside) { const label = new Date(d.date+'T12:00:00').toLocaleDateString('en',{month:'short'}); if(label!==previous) {result.push({column:i/7+1,label});previous=label;} } });
    return result.filter((month,i) => !result[i+1] || result[i+1].column-month.column >= 3);
  });
}
