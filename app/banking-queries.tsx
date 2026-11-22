'use client';
import {useCallback,useEffect,useState} from 'react';

type QueryItem={id:string;title:string;topic:string;question:string;answer:string;status:string;helpful_count:number;sort_order:number;created_at:string;updated_at:string;helpful_by_me:number};
export default function BankingQueries(){
 const [items,setItems]=useState<QueryItem[]>([]),[isAdmin,setIsAdmin]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=useCallback(async()=>{setLoading(true);try{const r=await fetch('/api/banking-queries',{cache:'no-store'});const b=await r.json() as {error?:string;items?:QueryItem[];isAdmin?:boolean};if(!r.ok)throw Error(b.error||'Could not load Banking Queries');setItems(b.items||[]);setIsAdmin(Boolean(b.isAdmin));setError('')}catch(e){setError(e instanceof Error?e.message:'Could not load Banking Queries')}finally{setLoading(false)}},[]);
 useEffect(()=>{void load()},[load]);
 async function helpful(item:QueryItem){if(item.helpful_by_me||busy)return;setBusy(item.id);try{const r=await fetch('/api/banking-queries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'helpful',id:item.id})});const b=await r.json() as {error?:string;helpfulCount?:number};if(!r.ok)throw Error(b.error||'Could not save feedback');setItems(old=>old.map(x=>x.id===item.id?{...x,helpful_count:Number(b.helpfulCount??x.helpful_count),helpful_by_me:1}:x))}catch(e){setError(e instanceof Error?e.message:'Could not save feedback')}finally{setBusy('')}}
 return <div className="banking-queries-page">
  <header className="banking-queries-heading"><div><span className="eyebrow">VISAFUND · BANKING KNOWLEDGE</span><h1>Banking Queries</h1><p>Common bank statement and financial-document questions, answered by VisaFund administrators.</p></div><span className="banking-queries-retention">Admin-managed · Permanent until manually changed</span></header>
  {error&&<p className="banking-queries-error" role="alert">{error}</p>}
  {loading?<section className="banking-queries-empty">Loading Banking Queries…</section>:items.length? <div className="banking-queries-list">{items.map(item=><article className="banking-query-card" key={item.id}><div className="banking-query-meta">{item.topic&&<span>{item.topic}</span>}<small>VisaFund Admin</small></div><h2>{item.title}</h2><section><h3>Question</h3><p>{item.question}</p></section><section className="banking-query-answer"><h3>Answer</h3><p>{item.answer}</p></section><footer><small>Updated {new Date(item.updated_at).toLocaleDateString()}</small><button type="button" disabled={Boolean(item.helpful_by_me)||busy===item.id} className={item.helpful_by_me?'is-helpful':''} onClick={()=>void helpful(item)}>{item.helpful_by_me?'Helpful ✓':'Helpful'} · {item.helpful_count}</button></footer></article>)}</div>:<section className="banking-queries-empty"><h2>No Banking Queries published yet</h2><p>New questions and answers from VisaFund administrators will appear here.</p></section>}
  {isAdmin&&<p className="banking-queries-admin-note">Administrator view: drafts are visible only to admins. Manage questions from Admin → Banking Queries.</p>}
 </div>
}
