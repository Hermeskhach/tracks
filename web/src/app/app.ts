import { Component, computed, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { A11yModule } from '@angular/cdk/a11y';
import { Heatmap } from './heatmap';
import { Activity, Track, dateKey, statistics } from './journal';
import { passwordProof, validatePassword } from './password-proof';

@Component({selector:'app-root', imports:[CommonModule, FormsModule, MatButtonModule, A11yModule, Heatmap], templateUrl:'./app.html'})
export class App {
  user = signal<{displayName:string;email:string}|null>(null);
  tracks = signal<Track[]>([]); activities = signal<Activity[]>([]);
  loading = signal(true); busy = signal(false); error = signal(''); toast = signal('');
  view = signal('home'); selectedId = signal(''); selectedDate = signal(''); year = signal(new Date().getFullYear());
  shared = signal(false); modal = signal(''); authMode = signal('login');
  today = dateKey(new Date()); date = new Date();
  credentials = {name:'', email:'', password:''};
  trackForm = {id:'', name:'', description:'', icon:'✦', color:'green', archived:false};
  activityForm = {id:'', projectId:'', title:'', date:this.today, description:'', value:null as number|null, unit:'min'};
  shareUrl = signal(''); shareEnabled = signal(false); shareExpiry = 'never';
  colors = ['green','blue','purple','orange','pink']; icons = ['✦','🇩🇪','↗','▧','▤','✳','☀','♫','⌘','🌱','🏃','🥊'];
  activeTracks = computed(() => this.tracks().filter(t => !t.archived));
  visibleTracks = computed(() => this.tracks().filter(t => t.archived === (this.view()==='archive')));
  selected = computed(() => this.tracks().find(t => t.id === this.selectedId()));
  selectedActivities = computed(() => this.activities().filter(a => a.projectId === this.selectedId()));
  stats = computed(() => statistics(this.selectedActivities()));
  allStats = computed(() => statistics(this.activities()));
  todayActivities = computed(() => this.activities().filter(a => a.date===this.today));
  history = computed(() => {
    const list = this.view()==='track' ? this.selectedActivities() : this.activities();
    return list.filter(a => !this.selectedDate() || a.date===this.selectedDate());
  });
  historyGroups = computed(() => [...new Set(this.history().map(a => a.date))].map(date => ({date,items:this.history().filter(a=>a.date===date)})));
  years = computed(() => {
    const first = Math.min(new Date().getFullYear(), ...this.selectedActivities().map(a => Number(a.date.slice(0,4))));
    return Array.from({length:new Date().getFullYear()-first+1},(_,i)=>new Date().getFullYear()-i);
  });
  private focusReturn: HTMLElement|null = null;
  constructor() { void this.init(); }
  @HostListener('window:popstate') onPop() { void this.init(); }
  @HostListener('document:keydown.escape') onEscape() { this.close(); }
  async request<T = any>(path:string, method='GET', body?:unknown): Promise<T> {
    const response = await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-Tracks-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
    if (!response.ok) { const data = await response.json().catch(()=>null); if(response.status===401 && this.user()) { this.user.set(null); this.tracks.set([]); this.activities.set([]); this.close(); } throw new Error(data?.message || (response.status===404?'This page or link is no longer available.':response.status===401?'Please sign in to continue.':response.status===429?'Too many attempts. Please wait a minute.':'Unable to save changes. Please try again.')); }
    return response.status===204 ? undefined as T : response.json().catch(()=>undefined);
  }
  async init() {
    this.loading.set(true); this.error.set('');
    const path = location.pathname.split('/').filter(Boolean);
    this.shared.set(path[0]==='p');
    try {
      if(this.shared()) { this.view.set('track'); this.tracks.set([]); this.activities.set([]); const data = await this.request<{track:Track;activities:Activity[]}>('/shared/'+encodeURIComponent(path[1]||'')); this.tracks.set([data.track]); this.activities.set(data.activities); this.selectedId.set(data.track.id); }
      else { this.user.set(await this.request('/auth/me')); await this.reload(); this.view.set(path[0]==='track'?'track':path[0]==='history'?'history':path[0]==='archive'?'archive':'home'); this.selectedId.set(path[1]||''); if(this.view()==='track'&&!this.selected()) this.navigate('home'); }
    } catch(e) { if(this.shared() || !(e instanceof Error) || e.message !== 'Please sign in to continue.') this.fail(e); }
    finally { this.loading.set(false); }
  }
  async reload() { const data = await this.request<{tracks:Track[];activities:Activity[]}>('/projects'); this.tracks.set(data.tracks); this.activities.set(data.activities); }
  async authenticate() { await this.perform(async()=> {
    const mode=this.authMode();
    if(mode==='register')validatePassword(this.credentials.password);
    const challenge=await this.request('/auth/challenge','POST',{email:this.credentials.email,mode});
    const proof=await passwordProof(this.credentials.password,challenge);
    await this.request('/auth/'+mode,'POST',{name:this.credentials.name,email:this.credentials.email,proof,ticket:challenge.ticket});
    this.credentials.password=''; this.user.set(await this.request('/auth/me')); await this.reload(); this.navigate('home');
  }); }
  async logout() { await this.perform(async()=> { await this.request('/auth/logout','POST'); this.user.set(null); this.tracks.set([]); this.activities.set([]); this.navigate('home'); }); }
  navigate(view:string,id='') { this.view.set(view); this.selectedId.set(id); this.selectedDate.set(''); this.year.set(new Date().getFullYear()); history.pushState({},'',view==='home'?'/':view==='track'?'/track/'+id:'/'+view); window.scrollTo(0,0); }
  trackActivities(id:string) { return this.activities().filter(a=>a.projectId===id); }
  trackToday(id:string) { return this.trackActivities(id).filter(a=>a.date===this.today); }
  monthCount(id:string) { return this.trackActivities(id).filter(a=>a.date.startsWith(this.today.slice(0,7))).length; }
  trackStats(id:string) { return statistics(this.trackActivities(id)); }
  trackFor(id:string) { return this.tracks().find(t=>t.id===id); }
  humanDate(date:string) { return date===this.today?'Today':new Date(date+'T12:00:00').toLocaleDateString('en',{weekday:'short',month:'long',day:'numeric',year:date.slice(0,4)!==this.today.slice(0,4)?'numeric':undefined}); }
  open(kind:string) { this.error.set(''); this.focusReturn=document.activeElement as HTMLElement; this.modal.set(kind); }
  close() { if(this.busy()) return; this.modal.set(''); this.error.set(''); setTimeout(()=>this.focusReturn?.focus(),0); }
  newTrack() { this.trackForm={id:'',name:'',description:'',icon:'✦',color:'green',archived:false}; this.open('track'); }
  editTrack() { const t=this.selected(); if(t) { this.trackForm={...t}; this.open('track'); } }
  log(trackId='') { if(!this.activeTracks().length) {this.newTrack();return;} this.activityForm={id:'',projectId:trackId||this.activeTracks()[0].id,title:'',date:this.today,description:'',value:null,unit:'min'}; this.open('activity'); }
  editActivity(a:Activity) { this.activityForm={...a,unit:a.unit||'min'}; this.open('activity'); }
  async saveTrack() { await this.perform(async()=> { const t=this.trackForm; await this.request(t.id?'/projects/'+t.id:'/projects',t.id?'PUT':'POST',t); await this.reload(); this.modal.set(''); this.notify(t.id?'Track updated':'Track created'); }); }
  async saveActivity() { await this.perform(async()=> { const a=this.activityForm; await this.request(a.id?'/activities/'+a.id:'/projects/'+a.projectId+'/activities',a.id?'PUT':'POST',a); await this.reload(); this.modal.set(''); this.notify(a.id?'Activity updated':'A little progress, recorded.'); }); }
  async archiveTrack() { await this.perform(async()=> { const t=this.selected()!; await this.request('/projects/'+t.id,'PUT',{...t,archived:!t.archived}); await this.reload(); this.modal.set(''); this.notify(t.archived?'Track restored':'Track archived. Your history is saved.'); }); }
  deleteActivity(a:Activity) { this.activityForm={...a,unit:a.unit||'min'}; this.open('delete'); }
  async confirmDelete() { await this.perform(async()=> {await this.request('/activities/'+this.activityForm.id,'DELETE');await this.reload();this.modal.set('');this.notify('Activity deleted');}); }
  async openShare() { this.shareUrl.set(''); this.shareEnabled.set(false); this.shareExpiry='never'; this.open('share'); await this.perform(async()=> {const data=await this.request('/projects/'+this.selectedId()+'/share');this.shareEnabled.set(data.enabled);}); }
  async createShare() { await this.perform(async()=> { const expiresAt=this.shareExpiry==='never'?null:new Date(Date.now()+Number(this.shareExpiry)*86400000).toISOString(); const data=await this.request('/projects/'+this.selectedId()+'/share','POST',{expiresAt});this.shareUrl.set(location.origin+'/p/'+data.token);this.shareEnabled.set(true);}); }
  async revokeShare() {await this.perform(async()=>{await this.request('/projects/'+this.selectedId()+'/share','DELETE');this.shareEnabled.set(false);this.shareUrl.set('');this.notify('Link revoked. This track is private.');});}
  async copyShare() {try {await navigator.clipboard.writeText(this.shareUrl());this.notify('Link copied');} catch {this.error.set('Select and copy the link below.');}}
  async addExamples() {await this.perform(async()=>{await this.request('/examples?today='+this.today,'POST');await this.reload();this.notify('Example tracks added. All entries are editable.');});}
  async perform(action:()=>Promise<void>) {if(this.busy())return;this.busy.set(true);this.error.set('');try{await action();}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  fail(e:unknown) {this.error.set(e instanceof Error?e.message:'Could not connect. Please try again.');}
  notify(message:string) {this.toast.set(message);setTimeout(()=>this.toast.set(''),4000);}
}
