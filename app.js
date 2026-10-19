/* Arabic-first UI for دليل الضمير التعليمي. Public content and application
   submission use Supabase; account management and admin review remain staged. */
const LEGACY_STORAGE_KEY = 'dameer-education-prototype-v1';
const stagesCatalog = [
  { name: 'المرحلة الابتدائية', grades: ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'] },
  { name: 'المرحلة الإعدادية', grades: ['السابع', 'الثامن', 'التاسع'] },
  { name: 'المرحلة الثانوية', grades: ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'] },
];
const subjectCatalog = ['اللغة العربية', 'اللغة الإنكليزية', 'الرياضيات', 'العلوم', 'الفيزياء', 'الكيمياء', 'الأحياء', 'التاريخ', 'الجغرافيا', 'الحاسوب'];
function emptyData() {
  return { schools: [], teachers: [], listings: [], memorials: [], teacherRequests: [], memorialRequests: [], slides: [] };
}
try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
let db = emptyData();
let view = 'home';
const dedicatedPageFiles = { apply: 'apply.html', manage: 'manage.html', admin: 'admin.html' };
let searchState = { query: '', mode: 'all', subject: '', grade: '', listingType: '' };
let homeSearchDraft = { query: '', mode: 'all', subject: '' };
let searchDebounceTimer = null;
let searchLimit = 20;
let searchResultFilter = 'all';
let heroIndex = 0;
let adminSection = 'overview';
let adminQueue = 'teachers';
let featuredAdminSearch = '';
let featuredAdminSort = 'name-asc';
let managingTeacherId = '';
let managingTeacherCode = '';
let manageError = '';
let teacherFormMode = 'teacher';
let selectedPhoto = '';
let selectedListingPhoto = '';
let selectedSchoolPhoto = '';
let selectedSlidePhoto = '';
let photoCrop = null;
let backendConnected = false;
let adminAccessToken = sessionStorage.getItem('dameer-admin-token-v1') || '';
let adminQueueLoaded = false;
let adminQueueLoading = false;
let adminLoginError = '';
let resetCodeTeacherId = '';
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
document.getElementById('year').textContent = new Date().getFullYear();

function persist() { try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {} }
async function supabaseRpc(name, payload) {
  const config=window.DAMEER_SUPABASE;
  if(!config?.url||!config?.anonKey)throw new Error('إعداد اتصال Supabase غير مكتمل.');
  let response;
  try { response=await fetch(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${config.anonKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
  catch { throw new Error('تعذر الوصول إلى Supabase. تحقق من الاتصال بالإنترنت.'); }
  if(!response.ok){let message='تعذر حفظ الطلب في قاعدة البيانات.';try{const body=await response.json();message=body.message||body.details||message;}catch{}throw new Error(message);}
  return response.json();
}
async function uploadImageDataUrl(dataUrl, folder) {
  if(!dataUrl)return null;
  if(!dataUrl.startsWith('data:image/jpeg;base64,'))throw new Error('صيغة الصورة غير مدعومة. أعد اختيار الصورة.');
  const config=window.DAMEER_SUPABASE;
  const blob=await (await fetch(dataUrl)).blob();
  if(blob.size>2*1024*1024)throw new Error('حجم الصورة أكبر من الحد المسموح (2 ميغابايت).');
  const path=`${folder}/${crypto.randomUUID()}.jpg`;
  let response;
  try{response=await fetch(`${config.url}/storage/v1/object/dameer-media/${path}`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${config.anonKey}`,'Content-Type':'image/jpeg','x-upsert':'false'},body:blob});}
  catch{throw new Error('تعذر رفع الصورة إلى مساحة التخزين. تحقق من اتصال الإنترنت.');}
  if(!response.ok){let body={};try{body=await response.json();}catch{}throw new Error(body.message||body.error||'فشل رفع الصورة إلى مساحة التخزين.');}
  return `${config.url}/storage/v1/object/public/dameer-media/${path}`;
}
async function supabaseRows(table, query='select=*') {
  const config=window.DAMEER_SUPABASE;
  const response=await fetch(`${config.url}/rest/v1/${table}?${query}`,{headers:{apikey:config.anonKey,Authorization:`Bearer ${config.anonKey}`}});
  if(!response.ok)throw new Error(`تعذر تحميل ${table} (${response.status})`);
  return response.json();
}
async function adminRpc(name,payload={}) {
  const config=window.DAMEER_SUPABASE;
  const response=await fetch(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${adminAccessToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok){let body={};try{body=await response.json();}catch{}throw new Error(body.message||body.details||'تعذّر تنفيذ الإجراء الإداري.');}
  return response.json();
}
async function loadAdminQueue() {
  if(adminQueueLoading||!adminAccessToken)return;
  adminQueueLoading=true;
  try {
    const [result,slideRows]=await Promise.all([adminRpc('admin_list_review_queue'),adminRpc('admin_list_homepage_slides')]);
    db.teacherRequests=(result.teachers||[]).map(r=>({id:String(r.id),status:r.status,createdAt:r.created_at,message:r.review_message||'',data:r.payload||{},kind:'teacher'}));
    db.memorialRequests=(result.memorials||[]).map(r=>({id:String(r.id),status:r.status,createdAt:r.created_at,message:r.review_message||'',data:{name:r.full_name,bio:r.biography,photo:r.photo_url||'',submitter:r.submitted_by||'',phone:r.submitter_contact||''},kind:'memorial'}));
    db.slides=(slideRows||[]).map(slide=>({id:String(slide.id),image:slide.image_url||'',eyebrow:slide.eyebrow||'',titleLine:slide.title_line||'',titleEmphasis:slide.title_emphasis||'',desc:slide.description||'',primary:slide.primary_text||'',primaryView:slide.primary_view||'teachers',secondary:slide.secondary_text||'',secondaryView:slide.secondary_view||'lessons',sortOrder:slide.sort_order||0,active:slide.is_active}));
    adminQueueLoaded=true;adminLoginError='';
  } catch(error) {
    adminLoginError=error.message||'تعذّر تحميل الطلبات.';
    if(/غير مصرح|jwt|token|auth/i.test(adminLoginError)){adminAccessToken='';sessionStorage.removeItem('dameer-admin-token-v1');}
  } finally {adminQueueLoading=false;render();}
}
async function loginAdmin(form) {
  const values=formValues(form),config=window.DAMEER_SUPABASE,button=form.querySelector('button[type="submit"]');
  button.disabled=true;button.textContent='جارٍ التحقق…';adminLoginError='';
  try {
    const response=await fetch(`${config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:values.email,password:values.password})});
    const session=await response.json();
    if(!response.ok)throw new Error(session.msg||session.message||'بيانات الدخول غير صحيحة.');
    adminAccessToken=session.access_token;sessionStorage.setItem('dameer-admin-token-v1',adminAccessToken);adminQueueLoaded=false;
    await loadAdminQueue();
  } catch(error){adminLoginError=error.message||'تعذر تسجيل الدخول.';button.disabled=false;button.textContent='دخول لوحة الإدارة';render();}
}
async function hydrateFromSupabase() {
  const status=document.getElementById('connection-status');
  try {
    const [schools,subjects,stages,grades,teachers,contacts,teacherSubjects,teacherGrades,teacherSchools,services,listings,memorials,homepageSlides]=await Promise.all([
      supabaseRows('schools','select=id,name,address,phone,whatsapp,location_url,description,image_url&is_active=eq.true&order=name'),
      supabaseRows('subjects','select=id,name&is_active=eq.true&order=sort_order'),
      supabaseRows('education_stages','select=id,name&is_active=eq.true&order=sort_order'),
      supabaseRows('grades','select=id,stage_id,name&is_active=eq.true&order=sort_order'),
      supabaseRows('teachers','select=id,public_id,full_name,gender,employment_status,biography,experience_years,address,photo_url,is_published,home_featured,home_badge_text&is_published=eq.true&order=full_name'),
      supabaseRows('teacher_contacts','select=teacher_id,contact_type,phone_number,sort_order&order=sort_order'),
      supabaseRows('teacher_subjects','select=teacher_id,subjects(name)'),
      supabaseRows('teacher_grade_assignments','select=teacher_id,grades(name),education_stages(name)'),
      supabaseRows('teacher_schools','select=teacher_id,school_id,schools(name)&is_current=eq.true'),
      supabaseRows('teacher_services','select=teacher_id,title&order=sort_order'),
      supabaseRows('teacher_listings','select=id,teacher_id,title,listing_type,description,location,price_text,image_url,start_date,grade_text,last_bumped_at,status,home_featured,home_badge_text,subjects!teacher_listings_subject_id_fkey(name),teacher_listing_subjects(subjects!teacher_listing_subjects_subject_id_fkey(name)),grades(name)&status=eq.published&order=last_bumped_at.desc'),
      supabaseRows('memorial_teachers','select=id,full_name,biography,photo_url,is_published,home_featured,home_badge_text&is_published=eq.true&order=full_name'),
      supabaseRows('homepage_slides','select=id,image_url,eyebrow,title_line,title_emphasis,description,primary_text,primary_view,secondary_text,secondary_view,sort_order,is_active&is_active=eq.true&order=sort_order,id'),
    ]);
    const related=(rows,id)=>rows.filter(row=>row.teacher_id===id);
    db.schools=schools.map(s=>({id:String(s.id),name:s.name,type:s.description||'مدرسة',address:s.address||'',phone:s.phone||'',whatsapp:s.whatsapp||'',location:s.location_url||'',image:s.image_url||''}));
    db.teachers=teachers.map(t=>({id:String(t.id),publicId:t.public_id,name:t.full_name,gender:t.gender,status:t.employment_status,years:t.experience_years||0,address:t.address||'',bio:t.biography||'',photo:t.photo_url||'',featured:!!t.home_featured,badgeText:t.home_badge_text||'',approved:true,demo:false,schoolId:String(related(teacherSchools,t.id)[0]?.school_id||''),subjects:related(teacherSubjects,t.id).map(x=>x.subjects?.name).filter(Boolean),stages:[...new Set(related(teacherGrades,t.id).map(x=>x.education_stages?.name).filter(Boolean))],grades:related(teacherGrades,t.id).map(x=>x.grades?.name).filter(Boolean),services:related(services,t.id).map(x=>x.title),contacts:related(contacts,t.id).map(x=>({type:x.contact_type,value:x.phone_number}))}));
    db.listings=listings.map(l=>{const subjects=(l.teacher_listing_subjects||[]).map(x=>x.subjects?.name).filter(Boolean);if(!subjects.length&&l.subjects?.name)subjects.push(l.subjects.name);return {id:String(l.id),teacherId:String(l.teacher_id),title:l.title,type:l.listing_type,description:l.description,subjects,subject:subjects.join('، '),grades:l.grade_text||l.grades?.name||'',startDate:l.start_date||'',location:l.location||'',price:l.price_text||'للتواصل والاستفسار',image:l.image_url||'',bumpAt:new Date(l.last_bumped_at).getTime(),status:l.status,featured:!!l.home_featured,badgeText:l.home_badge_text||'',demo:false};});
    db.memorials=memorials.map(m=>({id:String(m.id),name:m.full_name,bio:m.biography,photo:m.photo_url||'',featured:!!m.home_featured,badgeText:m.home_badge_text||'',approved:true,demo:false}));
    db.slides=homepageSlides.map(slide=>({id:String(slide.id),image:slide.image_url||'',eyebrow:slide.eyebrow||'',titleLine:slide.title_line||'',titleEmphasis:slide.title_emphasis||'',desc:slide.description||'',primary:slide.primary_text||'',primaryView:slide.primary_view||'teachers',secondary:slide.secondary_text||'',secondaryView:slide.secondary_view||'lessons',sortOrder:slide.sort_order||0,active:slide.is_active}));
    slides=db.slides.length?db.slides:[];if(slides.length&&heroIndex>=slides.length)heroIndex=0;
    db.teacherRequests=[];db.memorialRequests=[];
    subjectCatalog.splice(0,subjectCatalog.length,...subjects.map(s=>s.name));
    stagesCatalog.splice(0,stagesCatalog.length,...stages.map(s=>({name:s.name,grades:grades.filter(g=>g.stage_id===s.id).map(g=>g.name)})));
    backendConnected=true;status.innerHTML='<span class="demo-dot"></span> متصل بقاعدة البيانات — طلبات التقديم تُرسل للمراجعة';render();
  } catch(error) {
    backendConnected=false;db=emptyData();slides=[];status.innerHTML='<span class="demo-dot"></span> تعذّر الاتصال بقاعدة البيانات — لن تظهر بيانات حتى يعود الاتصال';render();console.warn('Supabase connection:',error);
  }
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function initials(name='') { return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join(''); }
function teacherById(id) { return db.teachers.find(t=>t.id===id); }
function schoolById(id) { return db.schools.find(s=>s.id===id); }
function fmtDate(date) { try { return new Intl.DateTimeFormat('ar-SY',{dateStyle:'medium'}).format(new Date(date)); } catch { return ''; } }
function setView(next, updateHistory=true) {
  clearTimeout(searchDebounceTimer);searchDebounceTimer=null;
  if(next==='home'&&view!=='home'){homeSearchDraft={query:'',mode:'all',subject:''};searchState={query:'',mode:'all',subject:'',grade:'',listingType:''};searchResultFilter='all';searchLimit=20;}
  const page=document.body.dataset.page||'public';
  if(dedicatedPageFiles[next]&&page!==next){location.href=`${dedicatedPageFiles[next]}#${next}`;return;}
  if(page!=='public'&&!dedicatedPageFiles[next]&&['home','teachers','lessons','schools','memorials','search'].includes(next)){location.href=`index.html#${next}`;return;}
  view=next;
  if(next==='admin'&&adminAccessToken)adminQueueLoaded=false;
  if(updateHistory&&location.hash!==`#${next}`)history.pushState({},'',`#${next}`);
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===next));
  document.querySelector('.main-nav')?.classList.remove('open');render();window.scrollTo({top:0,behavior:'smooth'});
}
window.addEventListener('popstate',()=>{
  const next=location.hash.slice(1)||'home';
  if(['home','teachers','lessons','schools','memorials','apply','manage','admin','search'].includes(next))setView(next,false);
});
function toast(message, error=false) { toastRoot.innerHTML=`<div class="toast ${error?'error':''}">${escapeHtml(message)}</div>`; const el=toastRoot.firstElementChild; requestAnimationFrame(()=>el.classList.add('show')); setTimeout(()=>el.classList.remove('show'),3000); }
function routeLink(label, next, extra='') { return `<button class="text-link ${extra}" data-view="${next}">${label} <span aria-hidden="true">←</span></button>`; }
function pageHero(title, subtitle, icon='✦') { return `<section class="page-hero"><div class="container page-hero-inner"><div><div class="section-kicker">دليل الضمير التعليمي</div><h1>${title}</h1><p>${subtitle}</p></div><div class="page-hero-icon" aria-hidden="true">${icon}</div></div></section>`; }
function sectionHead(kicker,title,desc,action='') { return `<div class="section-head"><div><div class="section-kicker">${kicker}</div><h2>${title}</h2>${desc?`<p>${desc}</p>`:''}</div>${action}</div>`; }
function avatarMarkup(person, small=false) { const genderClass=person.gender==='female'?'avatar-female':''; const sizeClass=small?' avatar-small':''; return `<div class="avatar ${genderClass}${sizeClass}">${person.photo?`<img src="${person.photo}" alt="صورة ${escapeHtml(person.name)}">`:escapeHtml(initials(person.name))}</div>`; }
function featuredAttrs(item,baseClass='') { return `class="${baseClass}${item.featured?' featured-card':''}"${item.featured?` data-featured="true"`:''}`; }
function featuredBadge(item) { return item.featured&&item.badgeText?`<span class="featured-badge">${escapeHtml(item.badgeText)}</span>`:''; }
function homeSelection(items,limit) {
  const featured=items.filter(item=>item.featured);
  const rest=items.filter(item=>!item.featured);
  const day=new Date().toISOString().slice(0,10);
  const score=item=>{let h=2166136261;for(const ch of `${day}:${item.id}`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  return [...featured,...rest.sort((a,b)=>score(a)-score(b))].slice(0,limit);
}
function teacherCard(t) {
  const subject=(t.subjects||[]).join('، ')||'معلم';
  const school=schoolById(t.schoolId);
  const stageTags=(t.stages||[]).map(stage=>`<span class="education-chip">${escapeHtml(stage.replace(/^المرحلة\s*/,''))}</span>`).join('')||'<span class="education-empty">غير محددة</span>';
  const gradeTags=(t.grades||[]).map(grade=>`<span class="education-chip">${escapeHtml(grade)}</span>`).join('')||'<span class="education-empty">غير محددة</span>';
  return `<article ${featuredAttrs(t,'teacher-card')} data-open-teacher="${escapeHtml(t.id)}">${featuredBadge(t)}
    ${t.demo?'<span class="badge-sample">مثال تجريبي</span>':''}
    <div class="teacher-top">${avatarMarkup(t)}<div><h3 class="teacher-name">${escapeHtml(t.name)}</h3><div class="teacher-subject">${escapeHtml(subject)}</div><div class="teacher-meta">${(t.status==='retired'?'<span class="tag retired">متقاعد</span>':'')}<span class="tag gender">${t.gender==='female'?'معلمة':'معلم'}</span>${school?`<span class="tag">${escapeHtml(school.name)}</span>`:''}</div></div></div>
    <div class="teacher-education"><div class="teacher-education-row"><span class="teacher-education-label"><svg class="education-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18M5 19V9l7-4 7 4v10M9 19v-6h6v6M8 10h.01M16 10h.01"/></svg>المراحل</span><div class="teacher-education-values">${stageTags}</div></div><div class="teacher-education-row"><span class="teacher-education-label"><svg class="education-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5c3.3-.9 6.3-.4 9 1.5v13c-2.7-1.9-5.7-2.4-9-1.5zM21 5.5c-3.3-.9-6.3-.4-9 1.5v13c2.7-1.9 5.7-2.4 9-1.5zM6 9h3M6 12h3M15 9h3M15 12h3"/></svg>الصفوف</span><div class="teacher-education-values">${gradeTags}</div></div></div>
    <p class="teacher-bio">${escapeHtml(t.bio||'لا توجد نبذة مضافة حتى الآن.')}</p>
    <div class="card-bottom"><span class="teacher-exp">${t.years?`${t.years} سنة خبرة`:'خبرة تعليمية'}</span><div class="teacher-actions"><button class="icon-btn" title="مشاركة البطاقة" data-share-teacher="${escapeHtml(t.id)}">↗</button>${t.contacts?.[0]?.value?`<a class="icon-btn" title="اتصال" href="tel:${escapeHtml(t.contacts[0].value)}" onclick="event.stopPropagation()">☎</a>`:''}<button class="btn btn-outline btn-small" data-open-teacher="${escapeHtml(t.id)}">عرض البطاقة</button></div></div>
  </article>`;
}
function listingCard(listing) {
  const teacher=teacherById(listing.teacherId); const subjectText=(listing.subjects||[]).join('، ')||listing.subject||'';const cover=listing.type==='course'?'gold-cover':(subjectText.includes('عربي')?'':'teal-cover');
  let startDate='';
  if(listing.startDate){
    const [year,month,day]=listing.startDate.split('-').map(Number);const target=new Date(year,month-1,day);const today=new Date();today.setHours(0,0,0,0);const days=Math.round((target-today)/86400000);
    const countdown=days>1?`باقي ${days} أيام`:days===1?'باقي يوم واحد':days===0?'تبدأ اليوم':`بدأت منذ ${Math.abs(days)} يوم`;
    startDate=`<div class="listing-start-date-card"><span>◷ ${listing.type==='course'?'تبدأ الدورة':'تبدأ الدروس الخصوصية'} في ${escapeHtml(new Intl.DateTimeFormat('ar-SY',{dateStyle:'long'}).format(target))}</span><small>${countdown}</small></div>`;
  }
  const contact=teacher?.contacts?.find(c=>c.type==='whatsapp'&&c.value)||teacher?.contacts?.find(c=>c.value);
  const contactButton=contact?contact.type==='whatsapp'?`<a class="btn btn-primary btn-small" href="https://wa.me/${contact.value.replace(/\D/g,'')}" target="_blank" rel="noopener" onclick="event.stopPropagation()">راسل المدرّس عبر واتساب</a>`:`<a class="btn btn-primary btn-small" href="tel:${escapeHtml(contact.value)}" onclick="event.stopPropagation()">اتصل بالمدرّس</a>`:'';
  return `<article ${featuredAttrs(listing,'listing-card')} data-listing-id="${escapeHtml(listing.id)}">${featuredBadge(listing)}<div class="listing-cover ${cover}" ${listing.image?`style="background-image:linear-gradient(180deg,rgba(8,35,61,.05),rgba(8,35,61,.45)),url('${escapeHtml(listing.image)}');background-size:cover;background-position:center"`:''}><span class="tag">${listing.type==='course'?'دورة تعليمية':'درس خصوصي'}</span></div><div class="listing-content"><h3>${escapeHtml(listing.title)}</h3><div class="listing-teacher">${teacher?`مع الأستاذ ${escapeHtml(teacher.name)}`:'إعلان تعليمي'}</div><div class="listing-subjects"><span>المواد</span><strong>${escapeHtml(subjectText||'تعليم')}</strong></div>${startDate}<p>${escapeHtml(listing.description)}</p><div class="listing-footer"><span class="listing-price">${escapeHtml(listing.price||'للتواصل')}</span><div class="teacher-actions"><button class="icon-btn" type="button" title="مشاركة الإعلان كصورة" aria-label="مشاركة الإعلان كصورة" data-share-listing="${escapeHtml(listing.id)}">↗</button>${contactButton}</div></div></div></article>`;
}
function schoolCard(s) {
  const staff=db.teachers.filter(t=>t.schoolId===s.id&&t.approved).length;
  const phone=s.phone?`<a class="btn btn-outline btn-small" href="tel:${escapeHtml(s.phone)}">اتصال</a>`:'';
  const map=s.location?`<a class="btn btn-quiet btn-small" href="${escapeHtml(s.location)}" target="_blank" rel="noopener">الموقع</a>`:'';
  return `<article class="school-card">${s.image?`<img class="school-photo" src="${escapeHtml(s.image)}" alt="صورة ${escapeHtml(s.name)}">`:'<div class="school-mark">▣</div>'}<h3>${escapeHtml(s.name)}</h3><div class="school-type">${escapeHtml(s.type||'مدرسة')}</div><p class="school-address">${escapeHtml(s.address||'العنوان غير مضاف')}</p><div class="school-footer"><span>الكادر التعليمي: <b>${staff}</b></span><div class="teacher-actions">${phone}${map}<button class="icon-btn" title="عرض الكادر" data-school-staff="${escapeHtml(s.id)}">⌕</button></div></div></article>`;
}
function memorialCard(m) { return `<article ${featuredAttrs(m,'memorial-card')}>${featuredBadge(m)}<div class="memorial-photo">${m.photo?`<img src="${m.photo}" alt="صورة ${escapeHtml(m.name)}">`:`<span class="memorial-monogram">${escapeHtml(initials(m.name))}</span>`}<span class="mourning-ribbon">رحمه الله</span></div><div class="memorial-copy"><h3>${escapeHtml(m.name)}</h3><p>${escapeHtml(m.bio)}</p></div></article>`; }
function emptyState(title, desc, icon='⌕') { return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${desc}</p></div>`; }

let slides=[];
function renderHero() {
  const s=slides[heroIndex]||slides[0];if(!s)return '';
  const heroImage=s.image?` style="background-image:linear-gradient(118deg,rgba(8,38,75,.94) 0%,rgba(12,61,115,.82) 55%,rgba(20,100,156,.72) 100%),url('${escapeHtml(s.image)}');background-size:cover;background-position:center"`:'';
  return `<section class="hero-wrap"><div class="container"><div class="hero"${heroImage}><div class="hero-content hero-slide"><span class="eyebrow">${escapeHtml(s.eyebrow)}</span><h1>${escapeHtml(s.titleLine)}<br><em>${escapeHtml(s.titleEmphasis)}</em></h1><p class="hero-desc">${escapeHtml(s.desc)}</p><div class="hero-actions"><button class="btn btn-white" data-view="${escapeHtml(s.primaryView||'teachers')}">${escapeHtml(s.primary)} <span>←</span></button><button class="btn btn-glass" data-view="${escapeHtml(s.secondaryView||'lessons')}">${escapeHtml(s.secondary)}</button></div><div class="slide-controls">${slides.map((_,i)=>`<button class="slide-dot ${i===heroIndex?'active':''}" aria-label="الشريحة ${i+1}" data-slide="${i}"></button>`).join('')}<button class="slide-arrow" aria-label="الشريحة التالية" data-slide-next>←</button></div></div><div class="hero-art" aria-hidden="true"><span class="hero-star s1">✦</span><div class="hero-orb"><div class="book-art"><div class="book-page left"><span class="book-lines"></span></div><div class="book-page right"><span class="book-lines"></span></div><div class="book-spine"></div></div></div><span class="hero-star s2">✧</span></div></div>
    <form class="search-panel" id="home-search"><label class="search-field"><span class="field-icon">⌕</span><input name="query" placeholder="اسم معلم، مادة، أو درس..." value="${escapeHtml(homeSearchDraft.query)}"></label><label class="search-field"><span class="field-icon">▤</span><select name="mode"><option value="all" ${homeSearchDraft.mode==='all'?'selected':''}>بحث شامل</option><option value="name" ${homeSearchDraft.mode==='name'?'selected':''}>حسب الاسم</option><option value="subject" ${homeSearchDraft.mode==='subject'?'selected':''}>حسب المادة</option><option value="grade" ${homeSearchDraft.mode==='grade'?'selected':''}>حسب الصف</option></select></label><label class="search-field"><span class="field-icon">⌄</span><select name="subject"><option value="" ${homeSearchDraft.subject===''?'selected':''}>كل المواد</option>${subjectCatalog.map(s=>`<option value="${escapeHtml(s)}" ${homeSearchDraft.subject===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></label><button class="btn btn-primary" type="submit">ابحث الآن <span>←</span></button></form>
    <div class="stats-row"><div class="stat-card"><span class="stat-icon">♙</span><div><strong>${db.teachers.filter(t=>t.approved&&t.gender==='male').length}</strong><span>معلمون</span></div></div><div class="stat-card"><span class="stat-icon teal">♙</span><div><strong>${db.teachers.filter(t=>t.approved&&t.gender==='female').length}</strong><span>معلمات</span></div></div><div class="stat-card"><span class="stat-icon gold">✦</span><div><strong>${db.listings.filter(x=>x.status==='published').length}</strong><span>دورات ودروس</span></div></div><div class="stat-card"><span class="stat-icon">▣</span><div><strong>${db.schools.length}</strong><span>مدارس</span></div></div></div></div></section>`;
}
function renderHome() {
  if(homeSearchDraft.query.trim())return `${renderHero()}${renderSearch(true)}`;
  return `${renderHero()}<section class="section"><div class="container">${sectionHead('ابدأ من هنا','كل ما تحتاجه في مكان واحد','اختر القسم الذي تبحث عنه، واستكشف مجتمع التعليم في الضمير.')}
    <div class="quick-grid"><article class="quick-card" data-view="teachers"><span class="quick-icon">♙</span><div><h3>المعلمون والمعلمات</h3><p>ابحث بحسب المادة والصف والخبرة</p></div><span class="quick-arrow">←</span></article><article class="quick-card" data-view="lessons"><span class="quick-icon">✎</span><div><h3>الدورات والدروس الخصوصية</h3><p>فرص تعليمية يعلن عنها المعلمون</p></div><span class="quick-arrow">←</span></article><article class="quick-card" data-view="schools"><span class="quick-icon">▣</span><div><h3>مدارس المدينة</h3><p>مواقع المدارس ووسائل التواصل والكادر</p></div><span class="quick-arrow">←</span></article></div></div></section>
    <section class="section section-white"><div class="container">${sectionHead('أهل الخبرة','معلمون ومعلمات من الضمير','تعرّف إلى الكادر التعليمي القريب منك.',routeLink('عرض الدليل كاملاً','teachers'))}<div class="teacher-grid">${homeSelection(db.teachers.filter(t=>t.approved),3).map(teacherCard).join('')}</div></div></section>
    <section class="section"><div class="container">${sectionHead('فرص قريبة','دورات ودروس معلنة','إعلانات تعليمية أضافها المعلمون مباشرة.',routeLink('كل الإعلانات','lessons'))}<div class="listing-grid">${homeSelection(db.listings.filter(x=>x.status==='published'),3).map(listingCard).join('')}</div></div></section>
    <section class="section section-white"><div class="container">${sectionHead('ذاكرة ووفاء','معلمون تركوا أثرًا','نحفظ ذكرى من زرعوا فينا المعرفة والود.',routeLink('اقرأ سيرهم','memorials'))}<div class="memorial-grid">${homeSelection(db.memorials.filter(m=>m.approved),2).map(memorialCard).join('')}</div><div class="impact-strip"><div><strong>هل ترغب بتقديم ذكرى معلم أو معلمة راحلين؟</strong><span>أرسل صورة ونبذة قصيرة لتصل إلى الإدارة للمراجعة.</span></div><button class="btn btn-outline" data-view="apply" data-form-kind="memorial">إرسال بطاقة تذكارية <span>←</span></button><span class="impact-mark">✦</span></div></div></section>`;
}
function normalizeSearchText(value='') {
  return String(value).normalize('NFD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').toLocaleLowerCase('ar')
    .replace(/[أإآٱ]/g,'ا').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ى/g,'ي').replace(/[هة]/g,'ه').replace(/\s+/g,' ').trim();
}
function searchMatches(fields,query) {
  const terms=normalizeSearchText(query).split(' ').filter(Boolean);if(!terms.length)return true;
  const haystack=normalizeSearchText(fields.filter(Boolean).join(' '));return terms.every(term=>haystack.includes(term));
}
function teacherMatches(t,q,mode,subject,grade) {
  const name=[t.name||''];const subjects=t.subjects||[];const grades=[...(t.stages||[]),...(t.grades||[])];
  const all=[...name,...subjects,...grades,t.bio,t.address,t.services||[],schoolById(t.schoolId)?.name||''];
  const searchFields=mode==='name'?name:mode==='subject'?subjects:mode==='grade'?grades:all;
  return searchMatches(searchFields,q)&&(!subject||subjects.includes(subject))&&(!grade||(t.grades||[]).includes(grade));
}
function renderTeachers() {
  const list=db.teachers.filter(t=>t.approved&&teacherMatches(t,searchState.query,searchState.mode,searchState.subject,searchState.grade)).sort((a,b)=>(a.status==='retired')-(b.status==='retired')||Number(b.featured)-Number(a.featured));
  const male=list.filter(t=>t.gender==='male').length, female=list.filter(t=>t.gender==='female').length;
  return `${pageHero('المعلمون والمعلمات','دليل يساعدك على الوصول إلى المعلم المناسب بحسب الاسم أو المادة أو الصف.','♙')}<section class="section"><div class="container"><div class="toolbar"><label class="search-field"><span class="field-icon">⌕</span><input id="teacher-query" placeholder="اكتب اسمًا أو مادة أو صفًا" value="${escapeHtml(searchState.query)}"></label><select class="search-field" id="teacher-mode"><option value="all" ${searchState.mode==='all'?'selected':''}>بحث شامل</option><option value="name" ${searchState.mode==='name'?'selected':''}>حسب الاسم</option><option value="subject" ${searchState.mode==='subject'?'selected':''}>حسب المادة</option><option value="grade" ${searchState.mode==='grade'?'selected':''}>حسب الصف</option></select><select class="search-field" id="teacher-subject"><option value="">كل المواد</option>${subjectCatalog.map(s=>`<option ${searchState.subject===s?'selected':''}>${s}</option>`).join('')}</select><select class="search-field" id="teacher-grade"><option value="">كل الصفوف</option>${stagesCatalog.flatMap(s=>s.grades).map(g=>`<option ${searchState.grade===g?'selected':''}>${g}</option>`).join('')}</select><span class="tag">المتقاعدون يظهرون بعد العاملين</span></div><div class="count-pills"><span class="count-pill">المعلمون <b>${male}</b></span><span class="count-pill">المعلمات <b>${female}</b></span><span class="count-pill">الإجمالي <b>${list.length}</b></span></div>${list.length?`<div class="teacher-grid">${list.slice(0,searchLimit).map(teacherCard).join('')}</div>${list.length>searchLimit?`<div class="pagination-row"><button class="btn btn-outline" data-load-more>عرض 20 نتيجة إضافية</button></div>`:''}`:emptyState('لا توجد نتائج مطابقة','جرّب كلمة بحث أخرى أو غيّر خيارات التصفية.')}</div></section>`;
}
function renderLessons() {
  const items=db.listings.filter(l=>l.status==='published'&&(!searchState.listingType||l.type===searchState.listingType)&&searchMatches([l.title,l.description,l.subjects||[],l.subject,l.grades,l.location,teacherById(l.teacherId)?.name||''],searchState.query));
  return `${pageHero('الدورات والدروس الخصوصية','إعلانات تعليمية يضيفها المعلمون بعد اعتماد بطاقاتهم، ويمكنهم تحديثها بأنفسهم.','✎')}<section class="section"><div class="container"><div class="toolbar"><label class="search-field"><span class="field-icon">⌕</span><input id="listing-query" placeholder="ابحث عن دورة أو مادة" value="${escapeHtml(searchState.query)}"></label><select class="search-field" id="listing-type"><option value="" ${!searchState.listingType?'selected':''}>كل الإعلانات</option><option value="private_lesson" ${searchState.listingType==='private_lesson'?'selected':''}>دروس خصوصية</option><option value="course" ${searchState.listingType==='course'?'selected':''}>دورات</option></select><span class="tag">${items.length} إعلان</span></div>${items.length?`<div class="listing-grid" id="listing-grid">${items.slice(0,searchLimit).map(listingCard).join('')}</div>${items.length>searchLimit?`<div class="pagination-row"><button class="btn btn-outline" data-load-more>عرض 20 إعلانًا إضافيًا</button></div>`:''}`:emptyState('لا توجد إعلانات بعد','ستظهر هنا إعلانات المعلمين عن الدورات والدروس الخصوصية.','✎')}</div></section>`;
}
function renderSchools() { return `${pageHero('مدارس مدينة الضمير','تعرّف إلى المدارس ومواقعها ووسائل التواصل، واكتشف المعلمين ضمن كادرها.','▣')}<section class="section"><div class="container">${db.schools.length?`<div class="school-grid">${db.schools.map(schoolCard).join('')}</div>`:emptyState('لا توجد مدارس مضافة','ستظهر المدارس بعد أن تضيفها الإدارة.','▣')}</div></section>`; }
function renderMemorials() { return `${pageHero('معلمون تركوا أثرًا','صفحات وفاء تخلّد ذكرى المعلمين والمعلمات الراحلين وتحتفظ بسيرتهم.','✦')}<section class="section"><div class="container">${db.memorials.filter(m=>m.approved).length?`<div class="memorial-grid">${db.memorials.filter(m=>m.approved).map(memorialCard).join('')}</div>`:emptyState('لا توجد بطاقات تذكارية بعد','يمكن إرسال طلب إضافة بطاقة للمراجعة من نموذج التقديم.','✦')}<div class="impact-strip"><div><strong>احفظوا ذكرى من علّمكم</strong><span>الصورة والنبذة تُعرضان بعد موافقة الإدارة.</span></div><button class="btn btn-outline" data-view="apply" data-form-kind="memorial">إرسال بطاقة تذكارية <span>←</span></button></div></div></section>`; }
function teacherForm() {
  const schools=db.schools.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  return `<h2 class="form-section-title">البيانات الأساسية</h2><div class="form-grid"><div class="field"><label>الاسم الكامل <span class="hint">مطلوب</span></label><input name="name" required maxlength="200" placeholder="الاسم كما ترغب أن يظهر في الدليل"></div><div class="field"><label>الصفة</label><select name="gender" required><option value="female">معلمة</option><option value="male">معلم</option></select></div><div class="field"><label>الحالة الوظيفية</label><select name="status"><option value="active">على رأس العمل</option><option value="retired">متقاعد / متقاعدة</option></select></div><div class="field"><label>سنوات الخبرة</label><input name="years" type="number" min="0" max="60" placeholder="مثال: 12"></div><div class="field full"><label>الصورة الشخصية <span class="hint">اختيارية</span></label><label class="upload-box"><span class="upload-symbol">▧</span><span><strong>اختر صورة من جهازك</strong><small>قصّ مربع للصورة قبل الرفع، والصورة اختيارية</small></span><input name="photo" type="file" accept="image/*" data-photo-input data-crop-ratio="1"></label></div><div class="field full"><label>نبذة مختصرة عنك</label><textarea name="bio" maxlength="700" placeholder="عرّف الطلاب والأهالي بخبرتك وطريقتك في التعليم"></textarea></div><div class="field full"><label>العنوان أو المنطقة <span class="hint">اختياري</span></label><input name="address" placeholder="مثال: مدينة الضمير — المركز"></div></div>
    <h2 class="form-section-title">المواد والمراحل</h2><div class="form-grid"><div class="field full"><label>المواد التي تدرّسها</label><div class="checkbox-grid">${subjectCatalog.map((s,i)=>`<label class="check-chip"><input type="checkbox" name="subjects" value="${s}"><span>${s}</span></label>`).join('')}</div></div><div class="field full"><label>المراحل التي تدرّسها</label><div class="checkbox-grid">${stagesCatalog.map((s,i)=>`<label class="check-chip"><input type="checkbox" name="stages" value="${s.name}" data-stage-check><span>${s.name.replace('المرحلة ','')}</span></label>`).join('')}</div></div><div class="field full" id="grade-fields"><label>الصفوف التي تدرّسها</label><div class="checkbox-grid">${stagesCatalog.flatMap(s=>s.grades).map(g=>`<label class="check-chip"><input type="checkbox" name="grades" value="${g}"><span>${g}</span></label>`).join('')}</div></div><div class="field"><label>المدرسة الحالية</label><select name="schoolId"><option value="">لا أختار مدرسة</option>${schools}</select><span class="hint">المدارس تُضاف من الإدارة وتظهر هنا تلقائيًا.</span></div><div class="field"><label>خدمات تعليمية</label><input name="services" placeholder="افصل بين الخدمات بفاصلة"></div></div>
    <h2 class="form-section-title">التواصل</h2><div class="form-grid"><div class="field"><label>رقم التواصل الأول</label><input name="phone1" required placeholder="رقم هاتف أو جوال"></div><div class="field"><label>نوع الرقم الأول</label><select name="phoneType1"><option value="mobile">جوال</option><option value="whatsapp">واتساب</option><option value="landline">هاتف أرضي</option></select></div><div class="field"><label>رقم ثانٍ <span class="hint">اختياري</span></label><input name="phone2" placeholder="رقم إضافي"></div><div class="field"><label>نوع الرقم الثاني</label><select name="phoneType2"><option value="whatsapp">واتساب</option><option value="mobile">جوال</option><option value="landline">هاتف أرضي</option></select></div></div>
    <div class="form-footer"><span class="consent">بإرسال الطلب، توافق على عرض بيانات البطاقة التي اخترت نشرها للزوار بعد مراجعتها.</span><button class="btn btn-primary" type="submit">إرسال الطلب للمراجعة <span>←</span></button></div>`;
}
function memorialForm() { return `<h2 class="form-section-title">بطاقة وفاء</h2><p class="field-hint" style="font-size:12px;color:#8291a0;line-height:1.8;margin:-5px 0 17px">أرسل صورة جميلة ونبذة عن المعلم أو المعلمة الراحلين. ستراجع الإدارة الطلب قبل نشره. لا يُنشأ رمز تعديل لهذه البطاقة.</p><div class="form-grid"><div class="field full"><label>اسم المعلم أو المعلمة</label><input name="memorialName" required maxlength="200" placeholder="الاسم الذي سيظهر على البطاقة"></div><div class="field full"><label>الصورة <span class="hint">اختيارية لكن يفضّل إضافتها</span></label><label class="upload-box"><span class="upload-symbol">▧</span><span><strong>اختر صورة مناسبة</strong><small>قصّ طولي 4:5 قبل الرفع لتناسب بطاقة الوفاء</small></span><input name="photo" type="file" accept="image/*" data-photo-input data-crop-ratio="0.8"></label></div><div class="field full"><label>نبذة عنه أو عنها</label><textarea name="memorialBio" required maxlength="1000" placeholder="اكتب نبذة قصيرة عن مسيرته وأثره في طلابه والمجتمع"></textarea></div><div class="field"><label>اسم مقدّم الطلب</label><input name="submitter" placeholder="اختياري"></div><div class="field"><label>رقم للتواصل عند الحاجة</label><input name="submitterPhone" placeholder="اختياري"></div></div><div class="form-footer"><span class="consent">تُعرض البطاقة بعد مراجعة الإدارة واعتمادها.</span><button class="btn btn-primary" type="submit">إرسال للمراجعة <span>←</span></button></div>`; }
function renderApply() {
  return `${pageHero('أضف صوتًا جديدًا للدليل','اختر نوع الطلب، واملأ المعلومات التي ترغب بمشاركتها مع أهل الضمير.','＋')}<section class="section"><div class="container form-layout"><form class="form-card" id="apply-form"><div class="form-choice"><button type="button" class="choice-card ${teacherFormMode==='teacher'?'selected':''}" data-form-mode="teacher"><span class="choice-emoji">♙</span><span><strong>معلم أو معلمة</strong><small>بطاقة تعليمية قابلة للإدارة</small></span></button><button type="button" class="choice-card ${teacherFormMode==='memorial'?'selected':''}" data-form-mode="memorial"><span class="choice-emoji">✦</span><span><strong>معلم راحل</strong><small>بطاقة تذكارية للمراجعة</small></span></button></div>${teacherFormMode==='teacher'?teacherForm():memorialForm()}<div id="form-result"></div></form><aside class="side-card"><h3>كيف يعمل الطلب؟</h3><p>يراجع فريق الإدارة المعلومات ثم يعتمد البطاقة أو يرسل لك ملاحظات لاستكمالها.</p><ul class="side-list">${teacherFormMode==='teacher'?'<li>بعد إرسال الطلب يظهر لك رمز من 8 أرقام، احتفظ به.</li><li>بعد اعتماد البطاقة، تستطيع تعديل البيانات المتغيرة وإضافة إعلاناتك.</li><li>تغيير الاسم يحتاج إلى مراجعة الإدارة.</li>':'<li>البطاقة التذكارية لا تحتاج إلى رمز تحكم.</li><li>يُراجع الاسم والصورة والنبذة قبل النشر.</li><li>تظهر البطاقة في قسم «معلمون تركوا أثرًا» بعد الاعتماد.</li>'}</ul><div class="warning-note">${backendConnected?'طلبك يُرسل إلى قاعدة البيانات للمراجعة. إدارة الاعتماد ستُربط بحساب إداري في الخطوة التالية.':'تعذر الاتصال الآن؛ لن يُرسل الطلب حتى يعود الاتصال بقاعدة البيانات.'}</div></aside></div></section>`;
}
function renderManage() {
  const teacher=teacherById(managingTeacherId);
  if(!teacher) return `${pageHero('إدارة بطاقتي','أدخل الاسم ورمز التحكم الذي ظهر لك عند تقديم الطلب.','⌘')}<section class="section"><div class="container"><form id="manage-login" class="form-card login-card"><h2 class="form-section-title">الدخول إلى إدارة البطاقة</h2><p style="font-size:12px;color:#7b8c9e;line-height:1.8;margin-top:0">استخدم الاسم كما أرسلته ورمز التحكم المكوّن من 8 أرقام.</p>${manageError?`<div class="notice-error">${escapeHtml(manageError)}</div>`:''}<div class="form-grid"><div class="field full"><label>الاسم الكامل</label><input name="name" required></div><div class="field full"><label>رمز التحكم</label><input name="code" required inputmode="numeric" maxlength="8" placeholder="••••••••"></div></div><div class="form-footer"><span class="consent">هل فقدت الرمز؟ اطلب من الإدارة إصدار رمز جديد بعد التحقق من هويتك.</span><button class="btn btn-primary" type="submit">متابعة <span>←</span></button></div></form></div></section>`;
  const ads=db.listings.filter(l=>l.teacherId===teacher.id);
  return `${pageHero('إدارة بطاقتي','عدّل معلوماتك المتغيرة وأدر إعلانات الدروس والدورات.','⌘')}<section class="section"><div class="container"><div class="manage-hero"><h2>مرحبًا ${escapeHtml(teacher.name)}</h2><p>الاسم مثبت في البطاقة. لتغييره، أرسل طلبًا للإدارة.</p></div><div class="form-card" style="margin-bottom:15px"><h2 class="form-section-title">بيانات البطاقة</h2><form id="profile-edit" data-id="${teacher.id}"><div class="form-grid"><div class="field"><label>الاسم</label><input value="${escapeHtml(teacher.name)}" disabled></div><div class="field"><label>الحالة الوظيفية</label><select name="status"><option value="active" ${teacher.status==='active'?'selected':''}>على رأس العمل</option><option value="retired" ${teacher.status==='retired'?'selected':''}>متقاعد / متقاعدة</option></select></div><div class="field"><label>سنوات الخبرة</label><input name="years" type="number" min="0" value="${teacher.years||''}"></div><div class="field"><label>المدرسة</label><select name="schoolId"><option value="">لا أختار مدرسة</option>${db.schools.map(s=>`<option value="${s.id}" ${teacher.schoolId===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select></div><div class="field full"><label>نبذة قصيرة</label><textarea name="bio">${escapeHtml(teacher.bio||'')}</textarea></div><div class="field full"><label>العنوان</label><input name="address" value="${escapeHtml(teacher.address||'')}"></div><div class="field full"><label>الخدمات التعليمية</label><input name="services" value="${escapeHtml((teacher.services||[]).join('، '))}"></div><div class="field"><label>رقم جوال / أرضي</label><input name="phone1" value="${escapeHtml(teacher.contacts?.[0]?.value||'')}"></div><div class="field"><label>نوع الرقم الأول</label><select name="phoneType1"><option value="mobile">جوال</option><option value="whatsapp">واتساب</option><option value="landline">هاتف أرضي</option></select></div><div class="field"><label>رقم ثانٍ</label><input name="phone2" value="${escapeHtml(teacher.contacts?.[1]?.value||'')}"></div><div class="field"><label>نوع الرقم الثاني</label><select name="phoneType2"><option value="whatsapp">واتساب</option><option value="mobile">جوال</option><option value="landline">هاتف أرضي</option></select></div></div><div class="form-footer"><span class="consent">التعديلات تظهر مباشرة في النسخة التجريبية.</span><button class="btn btn-primary" type="submit">حفظ التعديلات</button></div></form></div><div class="form-card"><div class="dash-heading"><div><h2>إعلاناتي</h2><p>أضف دورة أو درسًا خصوصيًا. إعادة الإظهار متاحة كل 3 أيام.</p></div><button class="btn btn-primary btn-small" data-add-listing>＋ إعلان جديد</button></div><div id="teacher-listings">${ads.length?ads.map(ad=>`<div class="listing-manage-row"><div><strong>${escapeHtml(ad.title)}</strong><small>${ad.type==='course'?'دورة':'درس خصوصي'} · آخر إظهار ${fmtDate(ad.bumpAt)}</small></div><div class="small-actions"><button class="btn btn-quiet btn-small" data-edit-listing="${ad.id}">تعديل</button><button class="btn btn-outline btn-small" data-bump-listing="${ad.id}" ${Date.now()-ad.bumpAt<72*3600000?'disabled':''}>إعادة النشر</button><button class="btn btn-danger btn-small" data-delete-listing="${ad.id}">حذف</button></div></div>`).join(''):emptyState('لا توجد إعلانات','أضف أول دورة أو درس خصوصي.','✎')}</div></div><div style="text-align:left;margin-top:12px"><button class="text-link" data-logout-manage>تسجيل الخروج من إدارة البطاقة</button></div></div></section>`;
}
function adminStats() { return `<div class="dashboard-cards"><div class="dash-stat"><span>طلبات المعلمين المعلّقة</span><strong>${db.teacherRequests.filter(r=>r.status==='pending'||r.status==='needs_changes').length}</strong></div><div class="dash-stat"><span>بطاقات تذكارية للمراجعة</span><strong>${db.memorialRequests.filter(r=>r.status==='pending'||r.status==='needs_changes').length}</strong></div><div class="dash-stat"><span>البطاقات المنشورة</span><strong>${db.teachers.filter(t=>t.approved).length+db.memorials.filter(m=>m.approved).length}</strong></div></div>`; }
function renderRequestCard(req,kind) {
  const isMem=kind==='memorial'; const data=req.data||{}; const statusLabel={pending:'بانتظار المراجعة',needs_changes:'بحاجة لاستكمال',approved:'معتمد',rejected:'مرفوض'}[req.status]||'قيد المراجعة';
  return `<article class="request-card"><div class="request-top"><div><h3>${escapeHtml(data.name)} ${isMem?'— بطاقة تذكارية':''}</h3><span class="request-date">وصل ${fmtDate(req.createdAt)}</span></div><span class="status-pill ${req.status}">${statusLabel}</span></div>${data.photo?`<img class="request-photo" src="${escapeHtml(data.photo)}" alt="صورة ${escapeHtml(data.name)}" loading="lazy">`:''}<div class="request-details">${isMem?`<span class="tag">${escapeHtml(data.submitter||'مقدّم طلب غير محدد')}</span>`:`<span class="tag">${data.gender==='female'?'معلمة':'معلم'}</span><span class="tag">${data.status==='retired'?'متقاعد':'على رأس العمل'}</span><span class="tag">${escapeHtml((data.subjects||[]).join('، ')||'دون مواد')}</span>`}</div><p style="font-size:11px;line-height:1.8;color:#78899a;margin:8px 0">${escapeHtml(isMem?data.bio:data.bio||'')}</p><textarea class="review-box" data-review-message="${req.id}" placeholder="اكتب رسالة للمتقدم عند طلب استكمال أو رفض">${escapeHtml(req.message||'')}</textarea><div class="request-actions"><button class="btn btn-primary btn-small" data-review="approve" data-id="${req.id}" data-kind="${kind}">اعتماد ونشر</button><button class="btn btn-outline btn-small" data-review="needs_changes" data-id="${req.id}" data-kind="${kind}">طلب استكمال</button><button class="btn btn-danger btn-small" data-review="reject" data-id="${req.id}" data-kind="${kind}">رفض الطلب</button></div></article>`;
}
function renderAdmin() {
  if(!adminAccessToken) return `${pageHero('دخول الإدارة','سجّل الدخول بحساب الإدارة المرتبط بمنصة الضمير التعليمية.','⌘')}<section class="section"><div class="container"><form id="admin-login" class="form-card login-card"><h2 class="form-section-title">تسجيل دخول الإدارة</h2><p style="font-size:12px;color:#7b8c9e;line-height:1.8;margin-top:0">أدخل بيانات حساب الإدارة الذي ربطناه للتو.</p>${adminLoginError?`<div class="notice-error">${escapeHtml(adminLoginError)}</div>`:''}<div class="form-grid"><div class="field full"><label>البريد الإلكتروني</label><input name="email" type="email" autocomplete="username" required></div><div class="field full"><label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required></div></div><div class="form-footer"><span class="consent">استخدم كلمة مرور حساب Supabase Auth.</span><button class="btn btn-primary" type="submit">دخول لوحة الإدارة</button></div></form></div></section>`;
  if(!adminQueueLoaded){if(!adminQueueLoading)queueMicrotask(()=>void loadAdminQueue());return `${pageHero('لوحة الإدارة','جارٍ تحميل طلبات المراجعة من قاعدة البيانات.','⌘')}<section class="section"><div class="container"><div class="form-card">${adminLoginError?`<div class="notice-error">${escapeHtml(adminLoginError)}</div><button class="btn btn-outline" data-admin-logout>تسجيل الخروج والمحاولة مجددًا</button>`:'جارٍ تحميل الطلبات…'}</div></div></section>`;}
  const pendingTeacherRequests=db.teacherRequests.filter(r=>r.status==='pending').length;
  const pendingMemorialRequests=db.memorialRequests.filter(r=>r.status==='pending').length;
  const pendingReviewCount=pendingTeacherRequests+pendingMemorialRequests;
  const menu=[['overview','نظرة عامة',pendingReviewCount],['teachers','طلبات المعلمين',pendingTeacherRequests],['memorials','البطاقات التذكارية',pendingMemorialRequests],['schools','إدارة المدارس',0],['listings','الإعلانات',0],['codes','رموز المعلمين',0],['featured','اختيارات الرئيسية',0],['slides','السلايدر الرئيسي',0]];
  let panel='';
  if(adminSection==='overview') panel=`<div class="dash-heading"><div><h2>لوحة الإدارة</h2><p>طلبات المراجعة محمّلة مباشرة من قاعدة البيانات.</p></div><button class="btn btn-quiet btn-small" data-admin-logout>تسجيل الخروج</button></div>${adminStats()}<div class="panel-card" style="padding:19px"><h3 style="font-size:15px;color:#234c70;margin:0 0 8px">قائمة المهام</h3><p style="font-size:12px;color:#7e8e9e;line-height:1.8;margin:0">اعتماد الطلب ينشر البطاقة مباشرة. أضف المدارس لتظهر في نموذج المعلمين.</p><div class="count-pills"><button class="count-pill" data-admin-section="teachers">طلبات معلمين <b>${db.teacherRequests.filter(r=>r.status==='pending').length}</b></button><button class="count-pill" data-admin-section="memorials">بطاقات تذكارية <b>${db.memorialRequests.filter(r=>r.status==='pending').length}</b></button></div></div>`;
  if(adminSection==='teachers') panel=`<div class="dash-heading"><div><h2>طلبات المعلمين والمعلمات</h2><p>اعتماد الطلب ينشر البطاقة مباشرة في الدليل.</p></div></div><div class="admin-tabs"><button class="admin-tab ${adminQueue==='teachers'?'active':''}" data-admin-queue="teachers">طلبات جديدة (${db.teacherRequests.filter(r=>r.status==='pending').length})</button><button class="admin-tab ${adminQueue==='teacher-history'?'active':''}" data-admin-queue="teacher-history">السجل</button></div>${(()=>{const rows=adminQueue==='teacher-history'?db.teacherRequests.filter(r=>r.status!=='pending'):db.teacherRequests.filter(r=>r.status==='pending'||r.status==='needs_changes');return rows.length?rows.map(r=>renderRequestCard(r,'teacher')).join(''):emptyState('لا توجد طلبات','ستظهر هنا طلبات المعلمين بعد إرسالها من النموذج.','♙')})()}`;
  if(adminSection==='memorials') panel=`<div class="dash-heading"><div><h2>البطاقات التذكارية</h2><p>مراجعة صور ونبذات المعلمين الراحلين.</p></div></div><div class="admin-tabs"><button class="admin-tab ${adminQueue==='memorials'?'active':''}" data-admin-queue="memorials">طلبات جديدة (${db.memorialRequests.filter(r=>r.status==='pending').length})</button><button class="admin-tab ${adminQueue==='memorial-history'?'active':''}" data-admin-queue="memorial-history">السجل</button></div>${(()=>{const rows=adminQueue==='memorial-history'?db.memorialRequests.filter(r=>r.status!=='pending'):db.memorialRequests.filter(r=>r.status==='pending'||r.status==='needs_changes');return rows.length?rows.map(r=>renderRequestCard(r,'memorial')).join(''):emptyState('لا توجد طلبات تذكارية','تظهر البطاقات المرسلة للمراجعة هنا.','✦')})()}`;
  if(adminSection==='schools') panel=`<div class="dash-heading"><div><h2>إدارة المدارس</h2><p>المدارس المضافة تظهر مباشرة ضمن خيارات المعلمين.</p></div></div><form class="form-card" id="school-add-form" style="margin-bottom:15px;padding:18px"><div class="form-grid"><div class="field"><label>اسم المدرسة</label><input name="name" required></div><div class="field"><label>نوع المدرسة</label><input name="type" placeholder="تعليم أساسي / ثانوي"></div><div class="field"><label>العنوان</label><input name="address"></div><div class="field"><label>هاتف التواصل</label><input name="phone"></div><div class="field"><label>رابط الموقع على الخريطة</label><input name="location" placeholder="https://..."></div><div class="field"><label>واتساب</label><input name="whatsapp"></div><div class="field full"><label>صورة المدرسة <span class="hint">اختيارية</span></label><label class="upload-box"><span class="upload-symbol">▣</span><span><strong>اختر صورة المدرسة</strong><small>قصّ أفقي مناسب للواجهة، وتُضغط الصورة تلقائيًا قبل رفعها</small></span><input type="file" accept="image/*" data-school-photo></label></div></div><div class="form-footer"><span class="consent">لا تنشر معلومات المدرسة إلا بعد التأكد منها.</span><button class="btn btn-primary btn-small" type="submit">إضافة مدرسة</button></div></form>${db.schools.map(s=>`<div class="school-admin-row">${s.image?`<img class="school-admin-photo" src="${escapeHtml(s.image)}" alt="">`:'<span class="school-admin-photo school-admin-photo-empty">▣</span>'}<div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.address||s.type||'')}</small></div><div class="school-admin-actions"><button class="btn btn-outline btn-small" data-edit-school="${escapeHtml(s.id)}">تعديل</button><button class="btn btn-danger btn-small" data-delete-school="${escapeHtml(s.id)}">حذف</button></div></div>`).join('')}`;
  if(adminSection==='listings') panel=`<div class="dash-heading"><div><h2>إعلانات الدروس والدورات</h2><p>الإعلانات المنشورة من المعلمين في النسخة التجريبية.</p></div></div>${db.listings.filter(l=>l.status==='published').length?db.listings.filter(l=>l.status==='published').map(l=>{const t=teacherById(l.teacherId);return `<div class="school-admin-row"><div><strong>${escapeHtml(l.title)}</strong><small>${escapeHtml(t?.name||'')} · ${l.type==='course'?'دورة':'درس خصوصي'}</small></div><button class="btn btn-danger btn-small" data-admin-delete-listing="${l.id}">إخفاء الإعلان</button></div>`}).join(''):emptyState('لا توجد إعلانات','ستظهر هنا إعلانات المعلمين.')}`;
  if(adminSection==='codes') panel=`<div class="dash-heading"><div><h2>رموز تحكم المعلمين</h2><p>تحقّق من هوية المعلم قبل إصدار رمز بديل. سيظهر الرمز مرة واحدة بعد الحفظ لتسليمه للمعلم.</p></div></div><div class="teacher-code-list">${db.teachers.filter(t=>t.approved).length?db.teachers.filter(t=>t.approved).map(t=>`<div class="teacher-code-row"><div class="teacher-code-info"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml((t.subjects||[]).join('، ')||'معلم')}</small></div><button class="btn btn-outline btn-small teacher-code-action" data-reset-teacher-code="${escapeHtml(t.id)}"><span aria-hidden="true">↻</span> إصدار رمز جديد</button></div>`).join(''):emptyState('لا توجد بطاقات منشورة','ستظهر بطاقات المعلمين المعتمدة هنا.')}</div>`;
  if(adminSection==='featured') {
    const itemRow=(kind,item,title,detail)=>`<form class="featured-admin-row" data-featured-form data-kind="${kind}" data-id="${escapeHtml(item.id)}"><div class="featured-admin-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div><label class="featured-admin-badge"><span>شارة اختيارية</span><input name="badge" maxlength="30" placeholder="مثال: اختيار الإدارة" value="${escapeHtml(item.badgeText||'')}"></label><label class="featured-admin-toggle"><input type="checkbox" name="featured" ${item.featured?'checked':''}><span>إبراز</span></label><button type="submit" class="btn btn-primary btn-small">حفظ</button></form>`;
    const records=[
      ...db.teachers.filter(t=>t.approved).map(item=>({kind:'teacher',item,title:item.name,detail:`${(item.subjects||[]).join('، ')||'معلم'}${item.status==='retired'?' · متقاعد':''}`,group:'teachers'})),
      ...db.listings.filter(item=>item.status==='published').map(item=>({kind:'listing',item,title:item.title,detail:`${teacherById(item.teacherId)?.name||'معلم'} · ${item.type==='course'?'دورة':'درس خصوصي'} · ${(item.subjects||[]).join('، ')||item.subject||''}`,group:'listings'})),
      ...db.memorials.filter(item=>item.approved).map(item=>({kind:'memorial',item,title:item.name,detail:'بطاقة تذكارية',group:'memorials'})),
    ];
    const searchTerm=featuredAdminSearch.trim();
    const filtered=records.filter(row=>!searchTerm||searchMatches([row.title,row.detail],searchTerm));
    const compareArabic=(a,b)=>a.title.localeCompare(b.title,'ar');
    filtered.sort((a,b)=>featuredAdminSort==='name-desc'?compareArabic(b,a):featuredAdminSort==='featured'?Number(Boolean(b.item.featured))-Number(Boolean(a.item.featured))||compareArabic(a,b):compareArabic(a,b));
    const groupNames={teachers:'المعلمون والمعلمات',listings:'الدورات والدروس الخصوصية',memorials:'معلمون تركوا أثرًا'};
    const groups=['teachers','listings','memorials'].map(group=>{const rows=filtered.filter(row=>row.group===group);return `<div class="featured-admin-group"><h3>${groupNames[group]} <span class="featured-group-count">${rows.length}</span></h3>${rows.length?rows.map(row=>itemRow(row.kind,row.item,row.title,row.detail)).join(''):`<p class="consent">${searchTerm?'لا توجد نتائج مطابقة في هذا القسم.':'لا توجد بطاقات منشورة.'}</p>`}</div>`;}).join('');
    panel=`<div class="dash-heading"><div><h2>اختيارات الصفحة الرئيسية</h2><p>اختر البطاقات التي تبرز في الرئيسية. الإطار الذهبي والشارة يرافقان البطاقة في كل الصفحات ونتائج البحث.</p></div></div><div class="featured-admin-toolbar"><label class="search-field"><span class="field-icon" aria-hidden="true">⌕</span><input id="featured-admin-search" type="search" value="${escapeHtml(featuredAdminSearch)}" placeholder="ابحث بالاسم أو الإعلان أو المادة" autocomplete="off"></label><label class="featured-sort-label"><span>ترتيب النتائج</span><select id="featured-admin-sort"><option value="name-asc" ${featuredAdminSort==='name-asc'?'selected':''}>الاسم: أ إلى ي</option><option value="name-desc" ${featuredAdminSort==='name-desc'?'selected':''}>الاسم: ي إلى أ</option><option value="featured" ${featuredAdminSort==='featured'?'selected':''}>المبرزة أولاً</option></select></label><span class="featured-result-count">${filtered.length} نتيجة</span></div>${groups}`;
  }
  if(adminSection==='slides') panel=`<div class="dash-heading"><div><h2>السلايدر الرئيسي</h2><p>عدّل النصوص والصور مع الحفاظ على تصميم الواجهة الحالي. الصور اختيارية وتظهر فوق الخلفية الموجودة.</p></div><button class="btn btn-primary btn-small" data-add-slide>＋ شريحة جديدة</button></div><div class="slide-admin-list">${db.slides.length?db.slides.slice().sort((a,b)=>a.sortOrder-b.sortOrder).map(slide=>`<div class="school-admin-row"><div>${slide.image?`<img class="school-admin-photo" src="${escapeHtml(slide.image)}" alt="">`:'<span class="school-admin-photo school-admin-photo-empty">✦</span>'}</div><div><strong>${escapeHtml(slide.eyebrow)} · ${escapeHtml(slide.titleLine)} ${escapeHtml(slide.titleEmphasis)}</strong><small>الترتيب ${slide.sortOrder+1} · ${slide.active?'ظاهرة':'مخفية'}</small></div><div class="school-admin-actions"><button class="btn btn-outline btn-small" data-edit-slide="${escapeHtml(slide.id)}">تعديل</button><button class="btn btn-danger btn-small" data-delete-slide="${escapeHtml(slide.id)}">حذف</button></div></div>`).join(''):emptyState('لا توجد شرائح','أضف أول شريحة للسلايدر.')}</div>`;
  return `${pageHero('إدارة المنصة','مراجعة الطلبات وإدارة المدارس والمحتوى.','⌘')}<section class="section"><div class="container dashboard-layout"><aside class="dashboard-nav">${menu.map(([id,label,count])=>`<button class="${adminSection===id?'active':''}" data-admin-section="${id}"><span>${label}</span>${count>0?`<b class="admin-nav-badge" aria-label="${count} طلبات تنتظر المراجعة">${count}</b>`:''}</button>`).join('')}</aside><div class="dashboard-main">${panel}<div class="admin-refresh-row"><button class="btn btn-outline btn-small" data-admin-refresh>تحديث قائمة المراجعة</button></div><div class="dashboard-lock">قائمة الطلبات متصلة بقاعدة البيانات. اعتماد البطاقة ينشرها مباشرة.</div></div></div></section>`;
}
function renderSearch(inline=false) {
  const q=searchState.query; const ts=db.teachers.filter(t=>t.approved&&teacherMatches(t,q,searchState.mode,searchState.subject,searchState.grade)).sort((a,b)=>(a.status==='retired')-(b.status==='retired')||Number(b.featured)-Number(a.featured));
  const ls=db.listings.filter(l=>{if(l.status!=='published')return false;const teacher=teacherById(l.teacherId);const fields=searchState.mode==='name'?[l.title,teacher?.name]:searchState.mode==='subject'?[l.subjects||[],l.subject]:searchState.mode==='grade'?[l.grades]:[l.title,l.description,l.subjects||[],l.subject,l.grades,l.location,teacher?.name];return searchMatches(fields,q);});
  const ms=db.memorials.filter(m=>m.approved&&searchMatches(searchState.mode==='name'?[m.name]:searchState.mode==='all'?[m.name,m.bio]:[],q));
  const ss=db.schools.filter(s=>searchMatches(searchState.mode==='all'?[s.name,s.type,s.address]:searchState.mode==='name'?[s.name]:[],q));
  const total=ts.length+ls.length+ms.length+ss.length;
  const visibleTs=searchResultFilter==='male'?ts.filter(t=>t.gender==='male'):searchResultFilter==='female'?ts.filter(t=>t.gender==='female'):['all','teachers'].includes(searchResultFilter)?ts:[];
  const visibleLs=['all','listings'].includes(searchResultFilter)?ls:[];
  const visibleMs=['all','memorials'].includes(searchResultFilter)?ms:[];
  const visibleSs=['all','schools'].includes(searchResultFilter)?ss:[];
  const result=[];
  visibleTs.forEach(t=>result.push({kind:'teacher',node:teacherCard(t)})); visibleLs.forEach(l=>result.push({kind:'listing',node:listingCard(l)})); visibleMs.forEach(m=>result.push({kind:'memorial',node:memorialCard(m)})); visibleSs.forEach(s=>result.push({kind:'school',node:schoolCard(s)}));
  const visibleTotal=result.length;
  const shown=result.slice(0,searchLimit); const sections=['teacher','listing','memorial','school'].map(k=>{const items=shown.filter(x=>x.kind===k);if(!items.length)return '';const label=k==='teacher'?'المعلمون والمعلمات':k==='listing'?'الدورات والدروس':k==='memorial'?'معلمون تركوا أثرًا':'المدارس';const count=k==='teacher'?visibleTs.length:k==='listing'?visibleLs.length:k==='memorial'?visibleMs.length:visibleSs.length;const grid=k==='teacher'?'teacher-grid':k==='listing'?'listing-grid':k==='memorial'?'memorial-grid':'school-grid';return `<div class="search-result-group"><div class="section-head"><div><h2 style="font-size:18px">${label}</h2></div><span class="tag">${count} نتيجة</span></div><div class="${grid}">${items.map(x=>x.node).join('')}</div></div>`}).join('');
  const countButton=(type,label,count)=>`<button type="button" class="count-pill ${searchResultFilter===type?'active':''}" data-search-type="${type}" aria-pressed="${searchResultFilter===type}" title="اضغط لعرض هذا القسم، واضغط ثانية لإلغاء التصفية">${label} <b>${count}</b></button>`;
  const counts=`<div class="count-pills">${countButton('male','المعلمون',ts.filter(t=>t.gender==='male').length)}${countButton('female','المعلمات',ts.filter(t=>t.gender==='female').length)}${countButton('listings','الدورات والدروس',ls.length)}${countButton('memorials','معلمون تركوا أثرًا',ms.length)}${countButton('schools','المدارس',ss.length)}</div>`;
  const results=`<div class="result-count">عرض ${Math.min(searchLimit,visibleTotal)} من ${visibleTotal} نتيجة${searchResultFilter!=='all'?' في القسم المحدد':''}، بحد أقصى 20 نتيجة في كل دفعة.</div>${visibleTotal?sections:emptyState('لا توجد نتائج في هذا القسم','جرّب قسمًا آخر أو اضغط على القسم المحدد مرة ثانية لإلغاء التصفية.')} ${visibleTotal>searchLimit?`<div class="pagination-row"><button class="btn btn-outline" data-load-more>عرض 20 نتيجة إضافية</button></div>`:''}`;
  if(inline)return `<section class="section section-white home-search-results"><div class="container">${counts}${results}</div></section>`;
  return `${pageHero('نتائج البحث',`نتائج البحث عن «${escapeHtml(q)}» في الدليل التعليمي.`,'⌕')}<section class="section"><div class="container"><div class="toolbar"><label class="search-field"><span class="field-icon">⌕</span><input id="global-query" value="${escapeHtml(q)}" placeholder="اكتب اسمًا أو مادة أو مدرسة"></label><select id="global-mode" class="search-field"><option value="all" ${searchState.mode==='all'?'selected':''}>بحث شامل</option><option value="name" ${searchState.mode==='name'?'selected':''}>حسب الاسم</option><option value="subject" ${searchState.mode==='subject'?'selected':''}>حسب المادة</option><option value="grade" ${searchState.mode==='grade'?'selected':''}>حسب الصف</option></select><button type="button" class="btn btn-outline" data-view="home">العودة للرئيسية</button></div>${counts}${results}</div></section>`;
}
function render() {
  const focusedHomeField=document.activeElement?.closest('#home-search')?document.activeElement:null;
  const focusedHomeFieldName=focusedHomeField?.name||'';
  const selectionStart=typeof focusedHomeField?.selectionStart==='number'?focusedHomeField.selectionStart:null;
  const selectionEnd=typeof focusedHomeField?.selectionEnd==='number'?focusedHomeField.selectionEnd:null;
  const focusedFeaturedSearch=document.activeElement?.id==='featured-admin-search';
  const featuredSelectionStart=focusedFeaturedSearch?document.activeElement.selectionStart:null;
  const featuredSelectionEnd=focusedFeaturedSearch?document.activeElement.selectionEnd:null;
  const map={home:renderHome,teachers:renderTeachers,lessons:renderLessons,schools:renderSchools,memorials:renderMemorials,apply:renderApply,manage:renderManage,admin:renderAdmin,search:renderSearch};
  app.innerHTML=(map[view]||renderHome)();
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  if(focusedHomeFieldName){const restored=document.querySelector('#home-search')?.elements.namedItem(focusedHomeFieldName);restored?.focus({preventScroll:true});if(selectionStart!==null&&typeof restored?.setSelectionRange==='function')restored.setSelectionRange(selectionStart,selectionEnd);}
  if(focusedFeaturedSearch){const restored=document.getElementById('featured-admin-search');restored?.focus({preventScroll:true});if(typeof featuredSelectionStart==='number')restored?.setSelectionRange(featuredSelectionStart,featuredSelectionEnd);}
}

function imageData(file, cb) {
  if(!file)return cb(''); if(!file.type.startsWith('image/'))return toast('اختر ملف صورة صالحًا.',true);
  const reader=new FileReader(); reader.onload=()=>{const img=new Image();img.onload=()=>{let scale=Math.min(1,1200/Math.max(img.width,img.height)),width=Math.round(img.width*scale),height=Math.round(img.height*scale),quality=.78;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const encode=()=>{canvas.width=width;canvas.height=height;ctx.drawImage(img,0,0,width,height);canvas.toBlob(blob=>{if(!blob)return toast('تعذر ضغط الصورة، جرّب صورة أخرى.',true);if(blob.size>450*1024&&width>480){width=Math.max(480,Math.round(width*.82));height=Math.max(1,Math.round(img.height*(width/img.width)));quality=Math.max(.48,quality-.05);encode();return;}const out=new FileReader();out.onload=()=>cb(out.result);out.readAsDataURL(blob);},'image/jpeg',quality);};encode();};img.onerror=()=>toast('تعذر قراءة الصورة، جرّب ملفًا آخر.',true);img.src=reader.result;};reader.readAsDataURL(file);
}
function openPhotoCrop(file,aspect,onComplete,inputElement) {
  if(!file)return;
  if(!file.type.startsWith('image/'))return toast('اختر ملف صورة صالحًا.',true);
  const img=new Image(),url=URL.createObjectURL(file);
  img.onerror=()=>{URL.revokeObjectURL(url);toast('تعذر قراءة الصورة، جرّب ملفًا آخر.',true);};
  img.onload=()=>{
    URL.revokeObjectURL(url);
    const width=320,height=Math.round(width/aspect),baseScale=Math.max(width/img.naturalWidth,height/img.naturalHeight);
    let zoom=1,offsetX=0,offsetY=0,drag=null;
    modalRoot.innerHTML=`<div class="modal-backdrop crop-backdrop" data-close-modal><section class="modal image-crop-modal" role="dialog" aria-modal="true" aria-label="قص الصورة"><button class="modal-close" data-crop-cancel aria-label="إلغاء">×</button><div class="crop-heading"><span class="crop-kicker">تجهيز الصورة</span><h2>اضبط إطار الصورة</h2><p>اسحب الصورة لتحديد الجزء المناسب، واستخدم الشريط للتكبير.</p></div><canvas class="crop-canvas" width="${width}" height="${height}" aria-label="معاينة قص الصورة"></canvas><label class="crop-zoom">تكبير الصورة<input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom></label><div class="crop-actions"><button type="button" class="btn btn-quiet" data-crop-cancel>إلغاء</button><button type="button" class="btn btn-primary" data-crop-accept>استخدام الصورة</button></div></section></div>`;
    const canvas=modalRoot.querySelector('.crop-canvas'),ctx=canvas.getContext('2d');
    const draw=()=>{
      const scale=baseScale*zoom,maxX=Math.max(0,(img.naturalWidth*scale-width)/2),maxY=Math.max(0,(img.naturalHeight*scale-height)/2);
      offsetX=Math.max(-maxX,Math.min(maxX,offsetX));offsetY=Math.max(-maxY,Math.min(maxY,offsetY));
      const x=(width-img.naturalWidth*scale)/2+offsetX,y=(height-img.naturalHeight*scale)/2+offsetY;
      ctx.clearRect(0,0,width,height);ctx.drawImage(img,x,y,img.naturalWidth*scale,img.naturalHeight*scale);
      ctx.strokeStyle='rgba(255,255,255,.66)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(width/3,0);ctx.lineTo(width/3,height);ctx.moveTo(width*2/3,0);ctx.lineTo(width*2/3,height);ctx.moveTo(0,height/3);ctx.lineTo(width,height/3);ctx.moveTo(0,height*2/3);ctx.lineTo(width,height*2/3);ctx.stroke();
    };
    photoCrop={draw,canvas,img,width,height,getDataUrl(){
      const scale=baseScale*zoom,x=(width-img.naturalWidth*scale)/2+offsetX,y=(height-img.naturalHeight*scale)/2+offsetY;
      const outWidth=800,outHeight=Math.round(outWidth/aspect),output=document.createElement('canvas');output.width=outWidth;output.height=outHeight;
      output.getContext('2d').drawImage(img,-x/scale,-y/scale,width/scale,height/scale,0,0,outWidth,outHeight);
      return output.toDataURL('image/jpeg',.88);
    },setZoom(value){zoom=value;draw();},onComplete,inputElement};
    draw();
    canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,offsetX,offsetY};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!drag)return;offsetX=drag.offsetX+(event.clientX-drag.x)*width/canvas.clientWidth;offsetY=drag.offsetY+(event.clientY-drag.y)*height/canvas.clientHeight;draw();});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
  };
  img.src=url;
}
function makeCode() { const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%100000000).padStart(8,'0'); }
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function checkedValues(form,name) { return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value); }
function showApplicationResult(html) { const box=document.getElementById('form-result'); if(box){box.innerHTML=html;box.scrollIntoView({behavior:'smooth',block:'center'});} }
async function handleTeacherSubmit(form) {
  const values=formValues(form); const code=makeCode();
  const contacts=[]; if(values.phone1)contacts.push({type:values.phoneType1,value:values.phone1}); if(values.phone2)contacts.push({type:values.phoneType2,value:values.phone2});
  const request={id:crypto.randomUUID(),createdAt:Date.now(),status:'pending',code,data:{id:crypto.randomUUID(),name:values.name,gender:values.gender,status:values.status,years:Number(values.years)||0,schoolId:values.schoolId||'',address:values.address||'',bio:values.bio||'',subjects:checkedValues(form,'subjects'),stages:checkedValues(form,'stages'),grades:checkedValues(form,'grades'),services:(values.services||'').split(/[،,]/).map(x=>x.trim()).filter(Boolean),contacts,photo:selectedPhoto,approved:false}};
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ إرسال الطلب…';
  let requestId;
  try { request.data.photo=await uploadImageDataUrl(selectedPhoto,'profiles');requestId=await supabaseRpc('submit_teacher_application',{p_requested_name:request.data.name,p_payload:request.data,p_control_code:code}); }
  catch(error){button.disabled=false;button.textContent='إرسال الطلب للمراجعة';toast(error.message||'تعذر إرسال الطلب.',true);return;}
  try { const saved=JSON.parse(localStorage.getItem('dameer-teacher-controls-v1')||'{}');saved[String(request.data.name).trim().toLocaleLowerCase('ar')]={name:request.data.name,code,requestId};localStorage.setItem('dameer-teacher-controls-v1',JSON.stringify(saved)); } catch {}
  showApplicationResult(`<div class="notice-success"><strong>استلمنا طلبك للمراجعة.</strong><br>احتفظ برمز التحكم الظاهر أدناه. بعد اعتماد البطاقة، استخدم الاسم والرمز لإدارة معلوماتك وإعلاناتك.</div><div class="code-display"><small>رمز التحكم الخاص بك — احتفظ به</small><strong>${code}</strong><button class="btn btn-glass btn-small" type="button" data-copy-code="${code}">نسخ الرمز</button></div><p class="consent">حُفظ الطلب في قاعدة البيانات، وحُفظ الرمز كتجزئة لا يمكن قراءتها من الجداول العامة. مراجعة الإدارة قيد الربط.</p>`); form.querySelector('button[type="submit"]').disabled=true;
}
async function handleMemorialSubmit(form) {
  const v=formValues(form); const request={id:crypto.randomUUID(),createdAt:Date.now(),status:'pending',data:{name:v.memorialName,bio:v.memorialBio,submitter:v.submitter||'',phone:v.submitterPhone||'',photo:selectedPhoto}};
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ إرسال الطلب…';
  try { request.data.photo=await uploadImageDataUrl(selectedPhoto,'memorials');await supabaseRpc('submit_memorial_application',{p_full_name:request.data.name,p_biography:request.data.bio,p_photo_url:request.data.photo||null,p_submitted_by:request.data.submitter||null,p_submitter_contact:request.data.phone||null}); }
  catch(error){button.disabled=false;button.textContent='إرسال البطاقة للمراجعة';toast(error.message||'تعذر إرسال الطلب.',true);return;}
  showApplicationResult('<div class="notice-success"><strong>وصلت البطاقة التذكارية إلى قائمة المراجعة.</strong><br>ستنشر بعد اعتمادها من الإدارة، ولا تحتاج إلى رمز تحكم.</div><p class="consent">حُفظ طلبك في قاعدة البيانات. لوحة مراجعة الإدارة ستُربط في الخطوة التالية.</p>');button.disabled=true;
}
function approveRequest(id,kind) {
  const list=kind==='memorial'?db.memorialRequests:db.teacherRequests; const req=list.find(x=>x.id===id); if(!req)return;
  const message=document.querySelector(`[data-review-message="${CSS.escape(id)}"]`)?.value||''; req.message=message;
  if(kind==='memorial') { if(!req.data.name||!req.data.bio){toast('لا يمكن اعتماد بطاقة بلا اسم ونبذة.',true);return;} db.memorials.unshift({id:crypto.randomUUID(),...req.data,approved:true,demo:false}); }
  else { const exists=db.teachers.some(t=>t.id===req.data.id);if(!exists)db.teachers.unshift({...req.data,approved:true,ownerCode:req.code,demo:false}); }
  req.status='approved';req.reviewedAt=Date.now();persist();render();toast('تم اعتماد الطلب ونشر البطاقة.');
}
function reviewRequest(id,kind,status) {
  if(adminAccessToken){void submitAdminDecision(id,kind,status);return;}
  if(status==='approve')return approveRequest(id,kind);
  const list=kind==='memorial'?db.memorialRequests:db.teacherRequests; const req=list.find(x=>x.id===id);if(!req)return;
  const message=document.querySelector(`[data-review-message="${CSS.escape(id)}"]`)?.value.trim()||'';
  if(status==='needs_changes'&&!message){toast('اكتب رسالة توضح ما يحتاج إلى استكمال.',true);return;}
  if(status==='reject'&&!message){toast('اكتب سبب الرفض أو ما يلزم لمراجعته.',true);return;}
  req.status=status==='needs_changes'?'needs_changes':'rejected';req.message=message;req.reviewedAt=Date.now();persist();render();toast(status==='needs_changes'?'أُعيد الطلب مع رسالة الاستكمال.':'تم حفظ قرار رفض الطلب.');
}
async function submitAdminDecision(id,kind,status){
  const message=document.querySelector(`[data-review-message="${CSS.escape(id)}"]`)?.value.trim()||'';
  if(status!=='approve'&&!message){toast(status==='needs_changes'?'اكتب ما يحتاج إلى استكمال.':'اكتب سبب الرفض.',true);return;}
  try{await adminRpc('admin_decide_request',{p_request_id:Number(id),p_kind:kind,p_decision:status,p_message:message||null});adminQueueLoaded=false;await loadAdminQueue();if(status==='approve'){await hydrateFromSupabase();toast('تم اعتماد الطلب ونشر البطاقة.');}else toast(status==='needs_changes'?'أُعيد الطلب مع رسالة الاستكمال.':'تم رفض الطلب.');}
  catch(error){toast(error.message||'تعذرت مراجعة الطلب.',true);}
}
async function saveFeaturedForm(form) {
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent='جارٍ الحفظ…';}
  try {
    const payload={p_kind:form.dataset.kind,p_entity_id:Number(form.dataset.id),p_featured:form.elements.featured.checked,p_badge:form.elements.badge.value.trim()||null};
    await adminRpc('admin_set_home_featured',payload);
    await hydrateFromSupabase();
    toast(payload.p_featured?'تم حفظ إبراز البطاقة.':'أُلغي إبراز البطاقة.');
  } catch(error) {toast(error.message||'تعذّر حفظ الاختيار. طبّق تحديث قاعدة البيانات أولاً.',true);if(button){button.disabled=false;button.textContent='حفظ';}}
}
function openTeacherCodeReset(id) {
  const teacher=teacherById(id);if(!teacher)return;
  resetCodeTeacherId=id;
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true"><button class="modal-close" data-close-modal>×</button><h2>إصدار رمز جديد</h2><p>للمعلم: <strong>${escapeHtml(teacher.name)}</strong></p><p>تحقّق من هويته عبر وسيلة تواصل تعرفها قبل المتابعة. الرمز الحالي سيتوقف عن العمل فور إصدار الجديد.</p><form id="teacher-code-reset-form"><label class="code-reset-confirm"><input type="checkbox" name="identityConfirmed" required><span>أؤكد أنني تحققت من هوية هذا المعلم.</span></label><div class="form-footer"><span class="consent">سيظهر الرمز مرة واحدة بعد الحفظ.</span><button class="btn btn-primary" type="submit">إصدار الرمز</button></div></form></section></div>`;
}
async function issueTeacherCode(form) {
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ الإصدار…';
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
  try {
    await adminRpc('admin_reset_teacher_code',{p_teacher_id:Number(resetCodeTeacherId),p_control_code:code});
    const teacher=teacherById(resetCodeTeacherId);
    modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true"><button class="modal-close" data-close-modal>×</button><h2>تم إصدار الرمز</h2><p>سلّم هذا الرمز للمعلم <strong>${escapeHtml(teacher?.name||'')}</strong> مباشرة. لن يظهر مجدداً بعد إغلاق هذه النافذة.</p><div class="issued-control-code" dir="ltr">${code}</div><div class="modal-actions"><button class="btn btn-primary" data-copy-code="${code}">نسخ الرمز</button><button class="btn btn-outline" data-close-modal>تم</button></div></section></div>`;
  } catch(error) {button.disabled=false;button.textContent='إصدار الرمز';toast(error.message||'تعذّر إصدار الرمز. تأكد من تطبيق تحديث قاعدة البيانات.',true);}
}
async function loginTeacher(form) {
  const values=formValues(form),button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ التحقق…';
  try {
    let found;
    if(backendConnected) {
      const verifiedId=await supabaseRpc('teacher_verify_access',{p_full_name:values.name,p_control_code:values.code});
      found=db.teachers.find(t=>String(t.id)===String(verifiedId));
    } else found=db.teachers.find(t=>t.name.trim().toLocaleLowerCase('ar')===values.name.trim().toLocaleLowerCase('ar')&&t.ownerCode===values.code);
    if(!found)throw new Error('لم نجد بطاقة معتمدة تطابق الاسم والرمز. تأكد منهما أو تواصل مع الإدارة.');
    managingTeacherId=found.id;managingTeacherCode=values.code;manageError='';setView('manage');
  } catch(error) {manageError=error.message||'تعذّر التحقق من الرمز.';button.disabled=false;button.textContent='متابعة ←';render();}
}
function logoutAdmin(){adminAccessToken='';adminQueueLoaded=false;adminLoginError='';sessionStorage.removeItem('dameer-admin-token-v1');render();}
function openTeacher(id) {
  const t=teacherById(id);if(!t)return;const school=schoolById(t.schoolId);
  const contacts=(t.contacts||[]).map(c=>`<a class="btn btn-outline btn-small" href="${c.type==='whatsapp'?`https://wa.me/${c.value.replace(/\D/g,'')}`:`tel:${escapeHtml(c.value)}`}" target="${c.type==='whatsapp'?'_blank':'_self'}" rel="noopener">${c.type==='whatsapp'?'راسل عبر واتساب':c.type==='landline'?'اتصال أرضي':'اتصال بالجوال'}</a>`).join('');
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-label="بطاقة المعلم"><button class="modal-close" data-close-modal aria-label="إغلاق">×</button><div class="modal-head">${avatarMarkup(t)}<div><h2>${escapeHtml(t.name)}</h2><div class="teacher-subject">${escapeHtml((t.subjects||[]).join('، '))}</div><div class="teacher-meta">${t.status==='retired'?'<span class="tag retired">متقاعد</span>':''}<span class="tag gender">${t.gender==='female'?'معلمة':'معلم'}</span>${school?`<span class="tag">${escapeHtml(school.name)}</span>`:''}</div></div></div><div class="modal-section"><h3>نبذة مختصرة</h3><p>${escapeHtml(t.bio||'لا توجد نبذة مضافة.')}</p></div><div class="modal-section"><h3>المراحل والصفوف</h3><p>${escapeHtml([...(t.stages||[]),...(t.grades||[])].join(' · ')||'لم تحدد')}</p></div><div class="modal-section"><h3>الخبرة والخدمات</h3><p>${t.years?`${t.years} سنة خبرة`:''} ${(t.services||[]).length?'· '+escapeHtml(t.services.join('، ')):''}</p></div>${t.address?`<div class="modal-section"><h3>العنوان</h3><p>${escapeHtml(t.address)}</p></div>`:''}<div class="modal-actions">${contacts}<button class="btn btn-primary btn-small" data-share-teacher="${t.id}">مشاركة البطاقة</button><button class="btn btn-quiet btn-small" data-download-card="${t.id}">تنزيل البطاقة كصورة</button></div></section></div>`;
}
async function shareTeacher(id) { const t=teacherById(id);if(!t)return;const url=`${location.origin}${location.pathname}?teacher=${encodeURIComponent(id)}`;try{if(navigator.share)await navigator.share({title:`بطاقة ${t.name} — دليل الضمير`,text:`${t.name} — ${t.subjects.join('، ')}`,url});else{await navigator.clipboard.writeText(url);toast('نُسخ رابط البطاقة.');}}catch(err){if(err.name!=='AbortError')toast('تعذرت مشاركة الرابط.',true);} }
function downloadCard(id) {
  const t=teacherById(id);if(!t)return;const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,1080,1350);bg.addColorStop(0,'#0a2d55');bg.addColorStop(.6,'#115b91');bg.addColorStop(1,'#dceffc');ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle='rgba(255,255,255,.1)';ctx.beginPath();ctx.arc(150,160,280,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(950,1180,320,0,Math.PI*2);ctx.fill();
  const school=schoolById(t.schoolId);const contact=t.contacts?.find(c=>c.type==='mobile'&&c.value)||t.contacts?.find(c=>c.type==='whatsapp'&&c.value)||t.contacts?.find(c=>c.value);const contactLabel=contact?.type==='landline'?'الهاتف':'الجوال / واتساب';
  ctx.fillStyle='#d9efff';ctx.font='600 38px IBM Plex Sans Arabic, sans-serif';ctx.textAlign='right';ctx.direction='rtl';ctx.fillText('منصة الضمير التعليمية',970,100);
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(540,335,135,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d9efff';ctx.font='700 100px IBM Plex Sans Arabic, sans-serif';ctx.textAlign='center';ctx.fillText(initials(t.name),540,370);
  ctx.fillStyle='#fff';ctx.font='700 55px IBM Plex Sans Arabic, sans-serif';ctx.fillText(t.name,540,555);ctx.font='500 31px IBM Plex Sans Arabic, sans-serif';ctx.fillStyle='#cae8ff';wrapCanvas(ctx,(t.subjects||[]).join(' · ')||'معلم',540,620,900,44);
  ctx.font='500 28px IBM Plex Sans Arabic, sans-serif';ctx.fillStyle='#fff';if(school)ctx.fillText(`المدرسة: ${school.name}`,540,745);if(contact)ctx.fillText(`${contactLabel}: ${contact.value}`,540,school?805:745);
  ctx.font='400 25px IBM Plex Sans Arabic, sans-serif';ctx.fillStyle='#eef7ff';const bio=(t.bio||'').trim();wrapCanvas(ctx,bio.length>180?`${bio.slice(0,177).trimEnd()}…`:bio,540,contact||school?890:800,880,43);
  ctx.fillStyle='#fff';ctx.font='500 24px IBM Plex Sans Arabic, sans-serif';ctx.fillText(`${t.status==='retired'?'متقاعد · ':''}${t.years||0} سنة خبرة`,540,1190);
  const a=document.createElement('a');a.download=`بطاقة-${t.name.replace(/\s+/g,'-')}.png`;a.href=canvas.toDataURL('image/png');a.click();toast('تم تنزيل البطاقة كصورة.');
}
function listingImageBlob(listing){
  const teacher=teacherById(listing.teacherId);const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,1080,1350);bg.addColorStop(0,'#0a2d55');bg.addColorStop(.62,listing.type==='course'?'#946c2c':'#147d80');bg.addColorStop(1,'#e8f2f8');ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle='rgba(255,255,255,.1)';ctx.beginPath();ctx.arc(140,170,270,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(990,1180,300,0,Math.PI*2);ctx.fill();
  ctx.direction='rtl';ctx.textAlign='center';ctx.fillStyle='#d9efff';ctx.font='600 38px IBM Plex Sans Arabic, sans-serif';ctx.fillText('منصة الضمير التعليمية',540,105);
  ctx.fillStyle='#ffffff';ctx.font='700 62px IBM Plex Sans Arabic, sans-serif';wrapCanvas(ctx,listing.title||'',540,270,900,82);
  ctx.fillStyle='#d7efff';ctx.font='500 35px IBM Plex Sans Arabic, sans-serif';ctx.fillText(`${listing.type==='course'?'دورة تعليمية':'درس خصوصي'}${teacher?` · الأستاذ ${teacher.name}`:''}`,540,480);
  const subjects=(listing.subjects||[]).join('، ')||listing.subject||'تعليم';ctx.fillStyle='#fff';ctx.font='600 35px IBM Plex Sans Arabic, sans-serif';ctx.fillText('المواد',540,610);ctx.font='500 32px IBM Plex Sans Arabic, sans-serif';wrapCanvas(ctx,subjects,540,670,900,52);
  let y=820;if(listing.startDate){const [year,month,day]=listing.startDate.split('-').map(Number);const date=new Intl.DateTimeFormat('ar-SY',{dateStyle:'long'}).format(new Date(year,month-1,day));ctx.fillStyle='#ffefc9';ctx.font='600 29px IBM Plex Sans Arabic, sans-serif';ctx.fillText(`${listing.type==='course'?'تبدأ الدورة':'تبدأ الدروس'} في ${date}`,540,y);y+=80;}
  ctx.fillStyle='#f2f7fc';ctx.font='400 29px IBM Plex Sans Arabic, sans-serif';wrapCanvas(ctx,listing.description||'',540,y,880,52);
  ctx.fillStyle='#fff';ctx.font='600 30px IBM Plex Sans Arabic, sans-serif';ctx.fillText(listing.price||'للتواصل والاستفسار',540,1190);
  return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
}
async function shareListing(id){
  const listing=db.listings.find(item=>item.id===id);if(!listing)return;const blob=await listingImageBlob(listing);if(!blob){toast('تعذر تجهيز صورة الإعلان.',true);return;}
  const safeTitle=(listing.title||'إعلان').replace(/[\\/:*?"<>|]/g,'-').slice(0,80);const file=new File([blob],`اعلان-${safeTitle}.png`,{type:'image/png'});const url=`${location.origin}${location.pathname}?listing=${encodeURIComponent(id)}#lessons`;
  if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:`${listing.title} — منصة الضمير التعليمية`,text:`${listing.title} عبر منصة الضمير التعليمية`,url});return;}catch(err){if(err.name==='AbortError')return;}}
  const a=document.createElement('a');a.download=file.name;a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);try{await navigator.clipboard.writeText(url);toast('نُزّلت صورة الإعلان ونُسخ رابطها للمشاركة.');}catch{toast('نُزّلت صورة الإعلان؛ يمكنك مشاركتها من جهازك.');}
}
function wrapCanvas(ctx,text,x,y,maxWidth,lineHeight){const words=text.split(/\s+/);let line='';for(const w of words){const test=line?line+' '+w:w;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=w;y+=lineHeight;}else line=test;}if(line)ctx.fillText(line,x,y);}
function addListing(teacher,values,id='') {
  const current=id?db.listings.find(l=>l.id===id):null;
  const listingData={title:values.title,type:values.type,description:values.description,subjects:values.subjects,subject:values.subjects.join('، '),startDate:values.startDate,grades:values.grades,location:values.location,price:values.price,image:values.image||current?.image||''};
  if(current){Object.assign(current,listingData,{updatedAt:Date.now()});}
  else db.listings.unshift({id:crypto.randomUUID(),teacherId:teacher.id,...listingData,price:values.price||'للتواصل والاستفسار',bumpAt:Date.now(),status:'published',demo:false});
  persist();render();toast(current?'تم تحديث الإعلان.':'تم نشر الإعلان مباشرة.');
}
async function deleteTeacherListing(id,button){
  const listing=db.listings.find(item=>item.id===id);if(!listing)return;
  if(backendConnected){button.disabled=true;try{await supabaseRpc('teacher_delete_listing',{p_teacher_id:Number(managingTeacherId),p_control_code:managingTeacherCode,p_listing_id:Number(id)});}catch(error){button.disabled=false;toast(error.message||'تعذر حذف الإعلان.',true);return;}}
  listing.status='deleted';persist();render();toast('حُذف الإعلان من قائمتك.');
}
async function bumpTeacherListing(id,button){
  const listing=db.listings.find(item=>item.id===id);if(!listing)return;
  if(Date.now()-listing.bumpAt<72*3600000){toast('يمكن إعادة النشر مرة كل 3 أيام.',true);return;}
  if(backendConnected){button.disabled=true;try{const bumpedAt=await supabaseRpc('teacher_bump_listing',{p_teacher_id:Number(managingTeacherId),p_control_code:managingTeacherCode,p_listing_id:Number(id)});listing.bumpAt=new Date(bumpedAt).getTime();}catch(error){button.disabled=false;toast(error.message||'تعذر إعادة إظهار الإعلان.',true);return;}}
  else listing.bumpAt=Date.now();
  persist();render();toast('أُعيد نشر الإعلان في مقدمة النتائج.');
}
async function saveListingForm(form){
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ حفظ الإعلان…';
  try{
    const values=formValues(form);values.subjects=[...form.querySelectorAll('input[name="subjects"]:checked')].map(input=>input.value);
    if(!values.subjects.length)throw new Error('اختر مادة واحدة على الأقل.');
    values.image=selectedListingPhoto?await uploadImageDataUrl(selectedListingPhoto,'listings'):'';
    const teacher=teacherById(managingTeacherId);if(!teacher)throw new Error('تعذر العثور على بطاقة المعلم. سجّل الدخول مجددًا.');
    if(backendConnected){
      const id=await supabaseRpc('teacher_save_listing',{p_teacher_id:Number(teacher.id),p_control_code:managingTeacherCode,p_listing_id:form.dataset.listingId?Number(form.dataset.listingId):null,p_title:values.title,p_listing_type:values.type,p_description:values.description,p_subject_names:values.subjects,p_start_date:values.startDate||null,p_grade_text:values.grades||null,p_location:values.location||null,p_price_text:values.price||null,p_image_url:values.image||null});
      const current=db.listings.find(item=>String(item.id)===String(id));
      const listingData={id:String(id),teacherId:String(teacher.id),title:values.title,type:values.type,description:values.description,subjects:values.subjects,subject:values.subjects.join('، '),startDate:values.startDate||'',grades:values.grades||'',location:values.location||'',price:values.price||'للتواصل والاستفسار',image:values.image||current?.image||'',bumpAt:current?.bumpAt||Date.now(),status:'published',featured:current?.featured||false,badgeText:current?.badgeText||'',demo:false};
      if(current)Object.assign(current,listingData);else db.listings.unshift(listingData);persist();render();toast(form.dataset.listingId?'تم تحديث الإعلان.':'تم نشر الإعلان مباشرة.');
    }else addListing(teacher,values,form.dataset.listingId);
    modalRoot.innerHTML='';
  }
  catch(error){button.disabled=false;button.textContent=form.dataset.listingId?'حفظ التعديل':'نشر الإعلان';toast(error.message||'تعذر حفظ الإعلان.',true);}
}
async function saveSchoolForm(form){
  const values=formValues(form),button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ حفظ المدرسة…';
  try{
    const imageUrl=selectedSchoolPhoto?await uploadImageDataUrl(selectedSchoolPhoto,'schools'):null;
    await adminRpc('admin_save_school',{p_name:values.name,p_type:values.type||null,p_address:values.address||null,p_phone:values.phone||null,p_whatsapp:values.whatsapp||null,p_location_url:values.location||null,p_image_url:imageUrl});
    selectedSchoolPhoto='';await hydrateFromSupabase();adminSection='schools';render();toast('تمت إضافة المدرسة وصورتها.');
  }catch(error){button.disabled=false;button.textContent='إضافة مدرسة';toast(error.message||'تعذرت إضافة المدرسة.',true);}
}
function editSchoolDialog(id){
  const school=db.schools.find(item=>item.id===String(id));if(!school)return;
  selectedSchoolPhoto='';
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-label="تعديل بيانات المدرسة"><button class="modal-close" data-close-modal aria-label="إغلاق">×</button><h2>تعديل بيانات المدرسة</h2><form id="school-edit-form" data-school-id="${escapeHtml(school.id)}"><div class="form-grid"><div class="field full"><label>اسم المدرسة</label><input name="name" required value="${escapeHtml(school.name)}"></div><div class="field"><label>نوع المدرسة</label><input name="type" value="${escapeHtml(school.type||'')}" placeholder="تعليم أساسي / ثانوي"></div><div class="field"><label>العنوان</label><input name="address" value="${escapeHtml(school.address||'')}"></div><div class="field"><label>هاتف التواصل</label><input name="phone" value="${escapeHtml(school.phone||'')}"></div><div class="field"><label>واتساب</label><input name="whatsapp" value="${escapeHtml(school.whatsapp||'')}"></div><div class="field full"><label>رابط الموقع على الخريطة</label><input name="location" value="${escapeHtml(school.location||'')}" placeholder="https://..."></div><div class="field full"><label>صورة المدرسة <span class="hint">اختيارية</span></label><label class="upload-box">${school.image?`<img class="upload-preview school-upload-preview" src="${escapeHtml(school.image)}" alt="">`:''}<span class="upload-symbol">▣</span><span><strong>اختر صورة جديدة</strong><small>اتركها كما هي للإبقاء على الصورة الحالية</small></span><input type="file" accept="image/*" data-school-photo></label></div></div><div class="form-footer"><span class="consent">تظهر التعديلات فور حفظها.</span><button class="btn btn-primary" type="submit">حفظ التعديلات</button></div></form></section></div>`;
}
async function updateSchoolForm(form){
  const values=formValues(form),button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ حفظ التعديلات…';
  try{
    const imageUrl=selectedSchoolPhoto?await uploadImageDataUrl(selectedSchoolPhoto,'schools'):null;
    await adminRpc('admin_update_school',{p_school_id:Number(form.dataset.schoolId),p_name:values.name,p_type:values.type||null,p_address:values.address||null,p_phone:values.phone||null,p_whatsapp:values.whatsapp||null,p_location_url:values.location||null,p_image_url:imageUrl});
    selectedSchoolPhoto='';modalRoot.innerHTML='';await hydrateFromSupabase();adminSection='schools';render();toast('تم حفظ تعديلات المدرسة.');
  }catch(error){button.disabled=false;button.textContent='حفظ التعديلات';toast(error.message||'تعذر تعديل المدرسة.',true);}
}
async function deleteSchool(id,button){
  button.disabled=true;
  try{await adminRpc('admin_delete_school',{p_school_id:Number(id)});await hydrateFromSupabase();adminSection='schools';render();toast('تم حذف المدرسة من الخيارات.');}
  catch(error){button.disabled=false;toast(error.message||'تعذر حذف المدرسة.',true);}
}
function slideDialog(id=''){
  const slide=id?db.slides.find(item=>item.id===String(id)):null;if(id&&!slide)return;selectedSlidePhoto='';
  const destinations=[['teachers','المعلمون والمعلمات'],['lessons','الدورات والدروس'],['schools','المدارس'],['memorials','تركوا أثرًا'],['apply','نموذج التقديم']];
  const options=current=>destinations.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal slide-editor-modal" role="dialog" aria-modal="true" aria-label="${slide?'تعديل الشريحة':'إضافة شريحة'}"><button class="modal-close" data-close-modal aria-label="إغلاق">×</button><h2>${slide?'تعديل الشريحة':'إضافة شريحة للسلايدر'}</h2><p class="consent">تحافظ الواجهة على الألوان والتوزيع الحاليين. الصورة اختيارية وتظهر كخلفية خفيفة خلف الرسم.</p><form id="homepage-slide-form" data-slide-id="${slide?escapeHtml(slide.id):''}" data-image-url="${escapeHtml(slide?.image||'')}"><div class="form-grid"><div class="field"><label>النص الصغير أعلى العنوان</label><input name="eyebrow" required maxlength="100" value="${escapeHtml(slide?.eyebrow||'')}"></div><div class="field"><label>ترتيب الشريحة</label><input name="sortOrder" type="number" min="1" value="${slide?slide.sortOrder+1:db.slides.length+1}" required></div><div class="field full"><label>السطر الأول من العنوان</label><input name="titleLine" required maxlength="200" value="${escapeHtml(slide?.titleLine||'')}"></div><div class="field full"><label>السطر الملوّن من العنوان</label><input name="titleEmphasis" required maxlength="200" value="${escapeHtml(slide?.titleEmphasis||'')}"></div><div class="field full"><label>النص التوضيحي</label><textarea name="description" required maxlength="600">${escapeHtml(slide?.desc||'')}</textarea></div><div class="field"><label>نص الزر الأول</label><input name="primary" required maxlength="80" value="${escapeHtml(slide?.primary||'')}"></div><div class="field"><label>وجهة الزر الأول</label><select name="primaryView">${options(slide?.primaryView||'teachers')}</select></div><div class="field"><label>نص الزر الثاني</label><input name="secondary" required maxlength="80" value="${escapeHtml(slide?.secondary||'')}"></div><div class="field"><label>وجهة الزر الثاني</label><select name="secondaryView">${options(slide?.secondaryView||'lessons')}</select></div><div class="field full"><label>صورة خلفية للشريحة <span class="hint">اختيارية</span></label><label class="upload-box">${slide?.image?`<img class="upload-preview" src="${escapeHtml(slide.image)}" alt="معاينة صورة السلايدر">`:''}<span class="upload-symbol">▧</span><span><strong>اختر صورة</strong><small>ستبقى الخلفية الزرقاء والرسم والتنسيق الحالي كما هي</small></span><input type="file" accept="image/*" data-slide-photo></label></div><div class="field full"><label class="check-chip"><input type="checkbox" name="isActive" ${slide?.active===false?'':'checked'}><span>إظهار هذه الشريحة</span></label></div></div><div class="form-footer"><span class="consent">سيظهر التعديل في الرئيسية فور الحفظ.</span><button type="submit" class="btn btn-primary">حفظ الشريحة</button></div></form></section></div>`;
}
async function saveHomepageSlide(form){
  const values=formValues(form),button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='جارٍ حفظ الشريحة…';
  try{
    const imageUrl=selectedSlidePhoto?await uploadImageDataUrl(selectedSlidePhoto,'slides'):(form.dataset.imageUrl||null);
    await adminRpc('admin_save_homepage_slide',{p_slide_id:form.dataset.slideId?Number(form.dataset.slideId):null,p_eyebrow:values.eyebrow,p_title_line:values.titleLine,p_title_emphasis:values.titleEmphasis,p_description:values.description,p_primary_text:values.primary,p_primary_view:values.primaryView,p_secondary_text:values.secondary,p_secondary_view:values.secondaryView,p_image_url:imageUrl,p_sort_order:Math.max(0,(Number(values.sortOrder)||1)-1),p_is_active:form.elements.isActive.checked});
    selectedSlidePhoto='';modalRoot.innerHTML='';await hydrateFromSupabase();adminQueueLoaded=false;await loadAdminQueue();adminSection='slides';render();toast('تم حفظ الشريحة في قاعدة البيانات.');
  }catch(error){button.disabled=false;button.textContent='حفظ الشريحة';toast(error.message||'تعذر حفظ الشريحة.',true);}
}
async function deleteHomepageSlide(id,button){
  if(!confirm('هل تريد حذف هذه الشريحة نهائيًا؟'))return;button.disabled=true;
  try{await adminRpc('admin_delete_homepage_slide',{p_slide_id:Number(id)});await hydrateFromSupabase();adminQueueLoaded=false;await loadAdminQueue();adminSection='slides';render();toast('تم حذف الشريحة.');}
  catch(error){button.disabled=false;toast(error.message||'تعذر حذف الشريحة.',true);}
}
function listingDialog(teacher, listing=null) {
  selectedListingPhoto='';
  const l=listing||{},selectedSubjects=l.subjects||((l.subject||'').split('،').map(x=>x.trim()).filter(Boolean));
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true"><button class="modal-close" data-close-modal>×</button><h2>${listing?'تعديل الإعلان':'إعلان دورة أو درس جديد'}</h2><p>يمكن اختيار أكثر من مادة للدورة أو الدرس.</p><form id="listing-form" data-listing-id="${l.id||''}"><div class="form-grid"><div class="field full"><label>عنوان الإعلان</label><input name="title" required value="${escapeHtml(l.title||'')}"></div><div class="field"><label>نوع الإعلان</label><select name="type" id="listing-editor-type"><option value="private_lesson" ${l.type==='private_lesson'?'selected':''}>درس خصوصي</option><option value="course" ${l.type==='course'?'selected':''}>دورة تعليمية</option></select></div><div class="field full"><label>المواد <span class="hint">اختر مادة أو أكثر</span></label><div class="checkbox-grid">${subjectCatalog.map(s=>`<label class="check-chip"><input type="checkbox" name="subjects" value="${escapeHtml(s)}" ${selectedSubjects.includes(s)?'checked':''}><span>${escapeHtml(s)}</span></label>`).join('')}</div></div><div class="field full listing-start-date"><label><span data-start-date-label>${l.type==='course'?'تاريخ بدء الدورة':'تاريخ بدء الدروس الخصوصية'}</span> <span class="hint">اختياري</span></label><input name="startDate" type="date" value="${escapeHtml(l.startDate||'')}"><span class="hint">سيظهر التاريخ على بطاقة الإعلان ليعرف الطلاب موعد البداية.</span></div><div class="field full"><label>وصف الإعلان</label><textarea name="description" required>${escapeHtml(l.description||'')}</textarea></div><div class="field"><label>الصفوف المناسبة</label><input name="grades" value="${escapeHtml(l.grades||'')}"></div><div class="field"><label>الموقع / طريقة التدريس</label><input name="location" value="${escapeHtml(l.location||'')}"></div><div class="field full"><label>السعر أو طريقة الاستفسار</label><input name="price" value="${escapeHtml(l.price||'للتواصل والاستفسار')}"></div></div><div class="form-footer"><span class="consent">يظهر الإعلان فور حفظه.</span><button type="submit" class="btn btn-primary">${listing?'حفظ التعديل':'نشر الإعلان'}</button></div></form></section></div>`;
  const imageField=`<div class="field full"><label>صورة الإعلان <span class="hint">اختيارية</span></label><label class="upload-box"><span class="upload-symbol">▧</span><span><strong>اختر صورة من جهازك</strong><small>تُرفع إلى مساحة الصور ولا تُحفظ داخل قاعدة البيانات</small></span><input type="file" accept="image/*" data-listing-photo></label></div>`;
  modalRoot.querySelector('.form-grid').insertAdjacentHTML('beforeend',imageField);
}

document.addEventListener('click',event=>{
  const searchType=event.target.closest('[data-search-type]');if(searchType){const next=searchType.dataset.searchType;searchResultFilter=searchResultFilter===next?'all':next;searchLimit=20;render();return;}
  const cropAccept=event.target.closest('[data-crop-accept]');if(cropAccept&&photoCrop){const crop=photoCrop,data=crop.getDataUrl();photoCrop=null;modalRoot.innerHTML='';crop.onComplete(data);return;}
  const cropCancel=event.target.closest('[data-crop-cancel]');if(cropCancel&&photoCrop){photoCrop.inputElement.value='';photoCrop=null;modalRoot.innerHTML='';return;}
  const viewBtn=event.target.closest('[data-view]');if(viewBtn){if(viewBtn.dataset.formKind)teacherFormMode=viewBtn.dataset.formKind;setView(viewBtn.dataset.view);return;}
  const mode=event.target.closest('[data-form-mode]');if(mode){teacherFormMode=mode.dataset.formMode;selectedPhoto='';render();return;}
  const slide=event.target.closest('[data-slide]');if(slide){heroIndex=Number(slide.dataset.slide);render();return;}
  if(event.target.closest('[data-slide-next]')){heroIndex=(heroIndex+1)%slides.length;render();return;}
  if(event.target.closest('[data-load-more]')){searchLimit+=20;render();return;}
  const teacher=event.target.closest('[data-open-teacher]');if(teacher){openTeacher(teacher.dataset.openTeacher);return;}
  const share=event.target.closest('[data-share-teacher]');if(share){event.stopPropagation();shareTeacher(share.dataset.shareTeacher);return;}
  const shareListingButton=event.target.closest('[data-share-listing]');if(shareListingButton){event.stopPropagation();void shareListing(shareListingButton.dataset.shareListing);return;}
  const down=event.target.closest('[data-download-card]');if(down){downloadCard(down.dataset.downloadCard);return;}
  const closeTarget=event.target.closest('[data-close-modal]');if(closeTarget&&(event.target===closeTarget||event.target.matches('button[data-close-modal]'))){if(photoCrop?.inputElement)photoCrop.inputElement.value='';photoCrop=null;modalRoot.innerHTML='';return;}
  const staff=event.target.closest('[data-school-staff]');if(staff){const s=schoolById(staff.dataset.schoolStaff);const teachers=db.teachers.filter(t=>t.schoolId===s?.id&&t.approved);modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal"><button class="modal-close" data-close-modal>×</button><h2>كادر ${escapeHtml(s?.name||'المدرسة')}</h2><p>${teachers.length?`<div class="teacher-grid">${teachers.map(teacherCard).join('')}</div>`:'لا توجد بطاقات معلمين مرتبطة بهذه المدرسة بعد.'}</p></section></div>`;return;}
  const adminSectionBtn=event.target.closest('[data-admin-section]');if(adminSectionBtn){adminSection=adminSectionBtn.dataset.adminSection;render();return;}
  if(event.target.closest('[data-add-slide]')){slideDialog();return;}
  const editSlideButton=event.target.closest('[data-edit-slide]');if(editSlideButton){slideDialog(editSlideButton.dataset.editSlide);return;}
  const deleteSlideButton=event.target.closest('[data-delete-slide]');if(deleteSlideButton){void deleteHomepageSlide(deleteSlideButton.dataset.deleteSlide,deleteSlideButton);return;}
  const resetTeacher=event.target.closest('[data-reset-teacher-code]');if(resetTeacher){openTeacherCodeReset(resetTeacher.dataset.resetTeacherCode);return;}
  if(event.target.closest('[data-admin-refresh]')){adminQueueLoaded=false;void loadAdminQueue();return;}
  const queue=event.target.closest('[data-admin-queue]');if(queue){adminQueue=queue.dataset.adminQueue;render();return;}
  const review=event.target.closest('[data-review]');if(review){reviewRequest(review.dataset.id,review.dataset.kind,review.dataset.review);return;}
  if(event.target.closest('[data-admin-logout]')){logoutAdmin();return;}
  const copy=event.target.closest('[data-copy-code]');if(copy){navigator.clipboard.writeText(copy.dataset.copyCode).then(()=>toast('نُسخ رمز التحكم.')).catch(()=>toast('انسخ الرمز يدويًا.',true));return;}
  if(event.target.closest('[data-logout-manage]')){managingTeacherId='';managingTeacherCode='';manageError='';setView('manage');return;}
  if(event.target.closest('[data-add-listing]')){listingDialog(teacherById(managingTeacherId));return;}
  const edit=event.target.closest('[data-edit-listing]');if(edit){const l=db.listings.find(x=>x.id===edit.dataset.editListing);listingDialog(teacherById(managingTeacherId),l);return;}
  const del=event.target.closest('[data-delete-listing]');if(del){void deleteTeacherListing(del.dataset.deleteListing,del);return;}
  const bump=event.target.closest('[data-bump-listing]');if(bump){void bumpTeacherListing(bump.dataset.bumpListing,bump);return;}
  const deleteSchoolButton=event.target.closest('[data-delete-school]');if(deleteSchoolButton){void deleteSchool(deleteSchoolButton.dataset.deleteSchool,deleteSchoolButton);return;}
  const editSchoolButton=event.target.closest('[data-edit-school]');if(editSchoolButton){editSchoolDialog(editSchoolButton.dataset.editSchool);return;}
  const adminDel=event.target.closest('[data-admin-delete-listing]');if(adminDel){const l=db.listings.find(x=>x.id===adminDel.dataset.adminDeleteListing);if(l)l.status='hidden';persist();render();toast('تم إخفاء الإعلان.');return;}
  const mobile=event.target.closest('.mobile-menu');if(mobile){const nav=document.querySelector('.main-nav');const open=nav.classList.toggle('open');mobile.setAttribute('aria-expanded',String(open));return;}
  if(event.target.classList.contains('modal-backdrop'))modalRoot.innerHTML='';
});

document.addEventListener('input',event=>{
  if(event.target.id==='featured-admin-search'){featuredAdminSearch=event.target.value;render();return;}
  if(event.target.closest('#home-search')){const form=event.target.closest('#home-search');homeSearchDraft={query:form.elements.query.value,mode:form.elements.mode.value,subject:form.elements.subject.value};clearTimeout(searchDebounceTimer);const scheduledView=view;searchDebounceTimer=setTimeout(()=>{if(view!==scheduledView||view!=='home')return;searchState={query:homeSearchDraft.query,mode:homeSearchDraft.mode,subject:homeSearchDraft.subject,grade:''};if(!homeSearchDraft.query.trim())searchResultFilter='all';searchLimit=20;render();},400);return;}
  const cropZoom=event.target.closest('[data-crop-zoom]');if(cropZoom&&photoCrop){photoCrop.setZoom(Number(cropZoom.value));return;}
  if(['teacher-query','teacher-subject','teacher-grade','teacher-mode','listing-query','global-query','global-mode'].includes(event.target.id)){
    const inputId=event.target.id;const isTyping=['teacher-query','listing-query','global-query'].includes(inputId);
    if(isTyping)searchState.query=event.target.value;
    if(event.target.id==='teacher-subject')searchState.subject=event.target.value;
    if(event.target.id==='teacher-grade')searchState.grade=event.target.value;
    if(event.target.id==='teacher-mode'||event.target.id==='global-mode')searchState.mode=event.target.value;
    searchLimit=20;
    const pos=isTyping?event.target.selectionStart:null;clearTimeout(searchDebounceTimer);
    const updateResults=()=>{const scheduledView=view;render();if(view!==scheduledView)return;const replacement=document.getElementById(inputId);replacement?.focus({preventScroll:true});if(typeof pos==='number')replacement?.setSelectionRange(pos,pos);};
    if(isTyping){const scheduledView=view;searchDebounceTimer=setTimeout(()=>{if(view===scheduledView)updateResults();},400);}
    else updateResults();
  }
});

document.addEventListener('change',event=>{
  if(event.target.id==='featured-admin-sort'){featuredAdminSort=event.target.value;render();return;}
  if(event.target.closest('#home-search')){if(event.target.tagName==='SELECT'){const form=event.target.closest('#home-search');homeSearchDraft={query:form.elements.query.value,mode:form.elements.mode.value,subject:form.elements.subject.value};searchState={query:homeSearchDraft.query,mode:homeSearchDraft.mode,subject:homeSearchDraft.subject,grade:''};if(!homeSearchDraft.query.trim())searchResultFilter='all';searchLimit=20;clearTimeout(searchDebounceTimer);render();}return;}
  if(event.target.id==='listing-editor-type'){
    const dateLabel=modalRoot.querySelector('[data-start-date-label]');
    if(dateLabel)dateLabel.textContent=event.target.value==='course'?'تاريخ بدء الدورة':'تاريخ بدء الدروس الخصوصية';
  }
  if(event.target.matches('[data-photo-input]'))openPhotoCrop(event.target.files?.[0],Number(event.target.dataset.cropRatio)||1,data=>{selectedPhoto=data;const label=event.target.closest('.upload-box');if(label){let prev=label.querySelector('.upload-preview');if(data){if(!prev){prev=document.createElement('img');prev.className='upload-preview';label.prepend(prev);}prev.className=`upload-preview crop-preview ${Number(event.target.dataset.cropRatio)===1?'crop-preview-square':'crop-preview-portrait'}`;prev.src=data;}}},event.target);
  if(event.target.matches('[data-listing-photo]'))imageData(event.target.files?.[0],data=>{selectedListingPhoto=data;const label=event.target.closest('.upload-box');if(label){let prev=label.querySelector('.upload-preview');if(data){if(!prev){prev=document.createElement('img');prev.className='upload-preview';label.prepend(prev);}prev.src=data;}}});
  if(event.target.matches('[data-school-photo]'))imageData(event.target.files?.[0],data=>{selectedSchoolPhoto=data;const label=event.target.closest('.upload-box');if(label){let prev=label.querySelector('.upload-preview');if(data){if(!prev){prev=document.createElement('img');prev.className='upload-preview';label.prepend(prev);}prev.className='upload-preview school-upload-preview';prev.src=data;}}});
  if(event.target.matches('[data-slide-photo]'))imageData(event.target.files?.[0],data=>{selectedSlidePhoto=data;const label=event.target.closest('.upload-box');if(label){let prev=label.querySelector('.upload-preview');if(data){if(!prev){prev=document.createElement('img');prev.className='upload-preview';label.prepend(prev);}prev.src=data;}}});
  if(event.target.matches('[data-stage-check]')){
    const selected=[...document.querySelectorAll('[data-stage-check]:checked')].map(x=>x.value);const allowed=stagesCatalog.filter(s=>selected.includes(s.name)).flatMap(s=>s.grades);
    document.querySelectorAll('#grade-fields input[name="grades"]').forEach(input=>{const label=input.closest('.check-chip');label.style.display=allowed.length&&!allowed.includes(input.value)?'none':'';if(!allowed.includes(input.value))input.checked=false;});
  }
  if(event.target.id==='listing-type'){
    searchState.listingType=event.target.value;searchLimit=20;render();document.getElementById('listing-type')?.focus({preventScroll:true});
  }
});

document.addEventListener('submit',event=>{
  const form=event.target;event.preventDefault();
  if(form.id==='admin-login'){void loginAdmin(form);return;}
  if(form.id==='teacher-code-reset-form'){void issueTeacherCode(form);return;}
  if(form.matches('[data-featured-form]')){void saveFeaturedForm(form);return;}
  if(form.id==='home-search'){
    const v=formValues(form);homeSearchDraft={query:v.query||'',mode:v.mode||'all',subject:v.subject||''};searchState={query:homeSearchDraft.query,mode:homeSearchDraft.mode,subject:homeSearchDraft.subject,grade:''};searchResultFilter='all';searchLimit=20;clearTimeout(searchDebounceTimer);render();return;
  }
  if(form.id==='apply-form'){if(teacherFormMode==='teacher')void handleTeacherSubmit(form);else void handleMemorialSubmit(form);return;}
  if(form.id==='manage-login'){
    void loginTeacher(form);return;
  }
  if(form.id==='profile-edit'){
    const t=teacherById(form.dataset.id);if(!t)return;const v=formValues(form);t.status=v.status;t.years=Number(v.years)||0;t.schoolId=v.schoolId||'';t.bio=v.bio;t.address=v.address;t.services=(v.services||'').split(/[،,]/).map(x=>x.trim()).filter(Boolean);t.contacts=[];if(v.phone1)t.contacts.push({type:v.phoneType1,value:v.phone1});if(v.phone2)t.contacts.push({type:v.phoneType2,value:v.phone2});persist();render();toast('تم حفظ التعديلات.');return;
  }
  if(form.id==='listing-form'){void saveListingForm(form);return;}
  if(form.id==='school-add-form'){void saveSchoolForm(form);return;}
  if(form.id==='school-edit-form'){void updateSchoolForm(form);return;}
  if(form.id==='homepage-slide-form'){void saveHomepageSlide(form);return;}
});

document.addEventListener('click',event=>{
  const findButton=event.target.closest('[data-search-submit]');if(findButton){setView('search');}
});

function renderWithAnchor(){render();const target=new URLSearchParams(location.search).get('teacher');if(target)openTeacher(target);}
const pageView=document.body.dataset.page;
const initial=location.hash.replace('#','');
if(['apply','manage','admin'].includes(pageView))view=pageView;
else if(dedicatedPageFiles[initial])location.replace(`${dedicatedPageFiles[initial]}#${initial}`);
else if(['home','teachers','lessons','schools','memorials','search'].includes(initial))view=initial;
renderWithAnchor();
void hydrateFromSupabase();
setInterval(()=>{if(view==='home'&&slides.length){heroIndex=(heroIndex+1)%slides.length;const y=window.scrollY;render();window.scrollTo(0,y);}},6500);

