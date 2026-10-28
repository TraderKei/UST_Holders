/* Project-written C99 JSON response writer. Standard C library only.
 * No third-party JSON code, parser, runtime or generated library is required.
 * This is a fixed-schema encoder, not a general-purpose JSON library.
 * DB/HTTP integration remains in the company's Altibase adapter.
 */
#include "ust_v2_json.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

typedef struct { char *data; size_t length, capacity; } Buffer;
typedef struct {
    Buffer meta,sources,countries,months,records;
    char dataset[37],first[8],latest[8],first_seen[8],last_seen[8];
    int seen,expected_entities,expected_months,expected_records;
    int source_count,entity_count,month_count,record_count,t3_count,hist_count;
} Build;

/* Failure injection is excluded from production builds. */
#ifdef UST_JSON_TESTING
static long remaining=-1;
void ust_v2_test_fail_after(long count) { remaining=count; }
static void *resize(void *ptr,size_t size) {
    if(remaining==0) return NULL;
    if(remaining>0) remaining--;
    return realloc(ptr,size);
}
#else
#define resize realloc
#endif

static int reserve(Buffer *b,size_t extra) {
    size_t need,capacity; char *next;
    if(b->length==SIZE_MAX || extra>SIZE_MAX-b->length-1) return 0;
    need=b->length+extra+1;
    if(need<=b->capacity) return 1;
    capacity=b->capacity?b->capacity:4096;
    while(capacity<need) {
        if(capacity>SIZE_MAX/2) {capacity=need;break;}
        capacity*=2;
    }
    next=resize(b->data,capacity);
    if(!next) return 0; /* Keep the old pointer for cleanup on failure. */
    b->data=next;b->capacity=capacity;return 1;
}
static int bytes(Buffer *b,const char *s,size_t n) {
    if(!reserve(b,n)) return 0;
    memcpy(b->data+b->length,s,n);b->length+=n;b->data[b->length]='\0';
    return 1;
}
static int put(Buffer *b,const char *s) { return bytes(b,s,strlen(s)); }

/* Reject malformed, overlong, surrogate and out-of-range UTF-8 sequences.
 * UTF-8 conversion from the company's DB charset belongs in its adapter.
 */
static int utf8(const unsigned char *s,size_t n) {
    size_t i=0,j,k; unsigned char c;
    while(i<n) {
        c=s[i];
        if(c<0x80) {i++;continue;}
        if(c>=0xc2 && c<=0xdf) k=2;
        else if(c>=0xe0 && c<=0xef) k=3;
        else if(c>=0xf0 && c<=0xf4) k=4;
        else return 0;
        if(k>n-i) return 0;
        for(j=1;j<k;j++) if(s[i+j]<0x80||s[i+j]>0xbf) return 0;
        if((c==0xe0 && s[i+1]<0xa0)||(c==0xed && s[i+1]>=0xa0)||
           (c==0xf0 && s[i+1]<0x90)||(c==0xf4 && s[i+1]>=0x90)) return 0;
        i+=k;
    }
    return 1;
}
static int quoted(Buffer *b,const char *s) {
    static const char hex[]="0123456789abcdef";
    size_t i,n; unsigned char c; char escaped[6]={'\\','u','0','0','0','0'};
    if(!s) return put(b,"null");
    n=strlen(s);
    if(!utf8((const unsigned char *)s,n)||!put(b,"\"")) return 0;
    for(i=0;i<n;i++) {
        c=(unsigned char)s[i];
        if(c=='"'||c=='\\') {
            char pair[2]={'\\',(char)c};if(!bytes(b,pair,2)) return 0;
        } else if(c<0x20) {
            escaped[4]=hex[c>>4];escaped[5]=hex[c&15];
            if(!bytes(b,escaped,6)) return 0;
        } else if(!bytes(b,s+i,1)) return 0;
    }
    return put(b,"\"");
}
static int key(Buffer *b,const char *name) {
    return put(b,",")&&quoted(b,name)&&put(b,":");
}
static int text(Buffer *b,const char *name,const char *value) {
    return key(b,name)&&quoted(b,value);
}
static int integer_token(Buffer *b,int value) {
    char s[32];int n=snprintf(s,sizeof(s),"%d",value);
    return n>0&&(size_t)n<sizeof(s)&&bytes(b,s,(size_t)n);
}
static int number(Buffer *b,const char *name,int value) {
    return key(b,name)&&integer_token(b,value);
}
/* q_* comments also identify queries in the fixture-only test adapter. */
static const char Q_CURRENT[] =
 "/* q_current */ SELECT s.CURRENT_DATASET_ID FROM UST_SERVICE_STATE s "
 "JOIN UST_DATASET d ON d.DATASET_ID=s.CURRENT_DATASET_ID "
 "WHERE s.SERVICE_KEY='UST_HOLDERS_V2' AND d.DATA_STATUS='PASS'";
static const char Q_META[] =
 "/* q_meta */ SELECT SCHEMA_VERSION,FIRST_MONTH,LATEST_MONTH,IS_PRELIMINARY,"
 "HISTORY_JOIN,TRANSACTION_START,OVERLAP_ROWS,OVERLAP_DIFFS,CROSS_CHECKS,"
 "HIST_ONLY_ENTITIES,ENTITY_COUNT,MONTH_COUNT,RECORD_COUNT "
 "FROM UST_DATASET WHERE DATASET_ID=? AND DATA_STATUS='PASS'";
static const char Q_SOURCES[] =
 "/* q_sources */ SELECT FILE_NAME,OFFICIAL_URL,DOWNLOADED_AT,SHA256_HEX,"
 "SOURCE_CODE FROM UST_SOURCE_FILE WHERE DATASET_ID=? "
 "ORDER BY CASE SOURCE_CODE WHEN 'T3' THEN 0 WHEN 'T5' THEN 1 "
 "WHEN 'HIST' THEN 2 ELSE 3 END";
static const char Q_COUNTRIES[] =
 "/* q_countries */ SELECT COUNTRY_NAME,COUNTRY_CODE,REGION_NAME,"
 "RECORD_TYPE,RANK_ELIGIBLE FROM UST_ENTITY WHERE DATASET_ID=? "
 "ORDER BY DISPLAY_ORDER";
static const char Q_MONTHS[] =
 "/* q_months */ SELECT DISTINCT REFERENCE_MONTH FROM UST_HOLDING "
 "WHERE DATASET_ID=? ORDER BY REFERENCE_MONTH";
static const char Q_RECORDS[] =
 "/* q_records */ SELECT h.COUNTRY_CODE,h.REFERENCE_MONTH,h.TOTAL_USD_MN,"
 "h.LT_USD_MN,h.ST_USD_MN,h.NET_USD_MN,h.LT_NET_USD_MN,h.ST_NET_USD_MN,"
 "h.LT_VAL_USD_MN,s.SOURCE_CODE FROM UST_HOLDING h "
 "JOIN UST_SOURCE_FILE s ON s.SOURCE_FILE_ID=h.SOURCE_FILE_ID "
 "AND s.DATASET_ID=h.DATASET_ID WHERE h.DATASET_ID=? "
 "ORDER BY h.COUNTRY_CODE,h.REFERENCE_MONTH";

static int integer(const char *s, int *value) {
    int n=0;
    if (!s || !*s) return 0;
    while (*s) {
        int d=*s++-'0';
        if(d<0 || d>9 || n>(2147483647-d)/10) return 0;
        n=n*10+d;
    }
    *value=n; return 1;
}
static int month(const char *s) {
    int i;
    if(!s || strlen(s)!=7 || s[4]!='-') return 0;
    for(i=0;i<7;i++) if(i!=4 && (s[i]<'0'||s[i]>'9')) return 0;
    return strncmp(s,"0000",4)!=0 && s[5]>='0' && s[5]<='1' &&
        (s[5]=='0' ? s[6]>='1'&&s[6]<='9' : s[6]>='0'&&s[6]<='2');
}


/* SQL numeric cells are not JSON strings. Validate the complete token first.
 * No float conversion, locale-sensitive formatting or untrusted raw fragments.
 */
static int decimal(Buffer *out,const char *input) {
    char token[64];const char *p;size_t n;int frac=0;
    uint64_t whole=0,tail=0;const uint64_t limit=UINT64_C(9007199254740991);
    if(!input) return put(out,"null");
    while(*input==' ') input++;
    n=strlen(input);while(n&&input[n-1]==' ') n--;
    if(!n||n>=sizeof(token)) return 0;
    memcpy(token,input,n);token[n]='\0';p=token;
    if(*p=='-') p++;
    if(*p<'0'||*p>'9'||(*p=='0'&&p[1]>='0'&&p[1]<='9')) return 0;
    while(*p>='0'&&*p<='9') {
        unsigned d=(unsigned)(*p++-'0');
        if(whole>(limit-d)/10) return 0;
        whole=whole*10+d;
    }
    if(*p=='.') {
        p++;
        while(*p>='0'&&*p<='9') {
            if(++frac>3) return 0;
            tail=tail*10+(unsigned)(*p++-'0');
        }
        if(!frac) return 0;
    }
    if(*p||whole>limit/1000) return 0;
    while(frac++<3) tail*=10;
    if(whole*1000+tail>limit) return 0;
    return bytes(out,token,n);
}
static int current(void *user,int n,const char *const *v) {
    Build *b=user;
    if(n!=1||b->seen++||!v[0]||strlen(v[0])!=36) return 0;
    memcpy(b->dataset,v[0],37);return 1;
}
static int metadata(void *user,int n,const char *const *v) {
    static const char *counts[]={"overlap_rows","overlap_differences","cross_checks","historical_only_entities"};
    Build *b=user;int i,x;
    if(n!=13||b->seen++||!integer(v[0],&x)||x!=2||!month(v[1])||!month(v[2])||
       strcmp(v[1],v[2])>0||!month(v[4])||!month(v[5])) return 0;
    memcpy(b->first,v[1],8);memcpy(b->latest,v[2],8);
    if(!put(&b->meta,"{\"schema_version\":2")||!text(&b->meta,"dataset_id",b->dataset)||
       !text(&b->meta,"source_mode","altibase")||!text(&b->meta,"first_month",v[1])||
       !text(&b->meta,"latest_month",v[2])||!text(&b->meta,"history_join",v[4])||
       !text(&b->meta,"transaction_start",v[5])) return 0;
    if(v[3]&&strcmp(v[3],"Y")&&strcmp(v[3],"N")) return 0;
    if(!key(&b->meta,"is_preliminary")||!put(&b->meta,!v[3]?"null":!strcmp(v[3],"Y")?"true":"false")) return 0;
    for(i=0;i<4;i++) if(!integer(v[i+6],&x)||!number(&b->meta,counts[i],x)) return 0;
    return integer(v[10],&b->expected_entities)&&b->expected_entities>0&&
        integer(v[11],&b->expected_months)&&b->expected_months>0&&
        integer(v[12],&b->expected_records)&&b->expected_records>0;
}
static int source(void *user,int n,const char *const *v) {
    static const char *codes[]={"T3","T5","HIST"};
    Build *b=user;Buffer *o=&b->sources;int i;
    if(n!=5||b->source_count>=3) return 0;
    for(i=0;i<5;i++) if(!v[i]) return 0;
    if(strcmp(v[4],codes[b->source_count])||strlen(v[3])!=64||strlen(v[2])<20||
       strlen(v[2])>30||v[2][10]!='T'||v[2][strlen(v[2])-1]!='Z') return 0;
    if(b->source_count && !put(o,",")) return 0;
    if(!put(o,"{\"file\":")||!quoted(o,v[0])||!text(o,"url",v[1])||
       !text(o,"downloaded_at",v[2])||!text(o,"sha256",v[3])||!put(o,"}")) return 0;
    if(!b->source_count && !text(&b->meta,"downloaded_at",v[2])) return 0;
    b->source_count++;return 1;
}
static int country(void *user,int n,const char *const *v) {
    Build *b=user;Buffer *o=&b->countries;int ranked;
    if(n!=5||!v[0]||!v[1]||!v[3]||!v[4]||b->entity_count>=b->expected_entities) return 0;
    if(strcmp(v[3],"country")&&strcmp(v[3],"region")&&strcmp(v[3],"institution")&&strcmp(v[3],"total")) return 0;
    ranked=!strcmp(v[4],"Y");
    if((!ranked&&strcmp(v[4],"N"))||ranked!=(!strcmp(v[3],"country"))) return 0;
    if(b->entity_count&&!put(o,",")) return 0;
    if(!put(o,"{\"country_name\":")||!quoted(o,v[0])||!text(o,"country_code",v[1])||
       !text(o,"region",v[2])||!text(o,"record_type",v[3])||!key(o,"rank_eligible")||
       !put(o,ranked?"true":"false")||!put(o,"}")) return 0;
    b->entity_count++;return 1;
}
static int period(void *user,int n,const char *const *v) {
    Build *b=user;
    if(n!=1||!month(v[0])||b->month_count>=b->expected_months) return 0;
    if(b->month_count && (strcmp(b->last_seen,v[0])>=0||!put(&b->months,","))) return 0;
    if(!quoted(&b->months,v[0])) return 0;
    if(!b->month_count) memcpy(b->first_seen,v[0],8);
    memcpy(b->last_seen,v[0],8);b->month_count++;return 1;
}
static int record(void *user,int n,const char *const *v) {
    Build *b=user;Buffer *o=&b->records;int i,src;
    if(n!=10||!v[0]||!month(v[1])||!v[9]||b->record_count>=b->expected_records) return 0;
    if(!strcmp(v[9],"T3")) src=0;
    else if(!strcmp(v[9],"HIST")) src=1;
    else return 0;
    if(b->record_count&&!put(o,",")) return 0;
    if(!put(o,"[")||!quoted(o,v[0])||!put(o,",")||!quoted(o,v[1])) return 0;
    for(i=2;i<9;i++) if(!put(o,",")||!decimal(o,v[i])) return 0;
    if(!put(o,",")||!integer_token(o,src)||!put(o,"]")) return 0;
    b->record_count++;if(src==0) b->t3_count++;else b->hist_count++;
    return 1;
}
static int rules(Buffer *out) {
    /* Only this compile-time schema constant is emitted without escaping.
     * Every DB-derived string passes through quoted() or decimal(). */
    return put(out,",\"base_unit\":\"USD million\",\"table5_unit\":\"USD billion\",\"ranking_record_type\":\"country\",\"comparison_lags_months\":[1,3,6,12],\"source_fields\":[\"for_treas_pos\",\"for_lt_treas_pos\",\"for_st_treas_pos\",\"for_treas_net\",\"for_lt_treas_net\",\"for_st_treas_net\",\"for_lt_treas_valchg\"],\"record_columns\":[\"country_code\",\"reference_month\",\"for_treas_pos\",\"for_lt_treas_pos\",\"for_st_treas_pos\",\"for_treas_net\",\"for_lt_treas_net\",\"for_st_treas_net\",\"for_lt_treas_valchg\",\"source_index\"],\"derived_fields\":{\"change\":\"current total holdings - exact lag-month total holdings\",\"change_pct\":\"change / exact lag-month total holdings * 100\",\"share_of_grand_total_pct\":\"entity total holdings / Grand Total * 100\",\"long_term_share_pct\":\"long-term holdings / total holdings * 100\",\"short_term_share_pct\":\"short-term holdings / total holdings * 100\",\"rank\":\"descending total holdings among record_type=country only\",\"other_adjustment_usd_mn\":\"monthly change - net transactions - long-term valuation change\",\"null_rule\":\"missing comparison month, missing operand, or zero denominator => null\"},\"status\":\"\\uac80\\uc99d \\uc644\\ub8cc \\uc218\\uc9d1\\ubcf8 \\u00b7 \\uc218\\uc815 \\uac00\\ub2a5 \\u00b7 \\uc7a0\\uc815 \\uc5ec\\ubd80 \\ubbf8\\ud45c\\uae30\"");
}
int ust_v2_build(const UstReader *r,char **body,size_t *length,char *error,size_t cap) {
    Build b;Buffer out={0};int ok=0;
    if(!body||!length) return 0;
    *body=NULL;*length=0;memset(&b,0,sizeof(b));
    if(error&&cap) error[0]='\0';
    if(!r||!r->query) goto done;
    if(!r->query(r->db,Q_CURRENT,NULL,current,&b)||b.seen!=1) goto done;
    b.seen=0;
    if(!r->query(r->db,Q_META,b.dataset,metadata,&b)||b.seen!=1||!rules(&b.meta)||
       !r->query(r->db,Q_SOURCES,b.dataset,source,&b)||b.source_count!=3||
       !r->query(r->db,Q_COUNTRIES,b.dataset,country,&b)||
       !r->query(r->db,Q_MONTHS,b.dataset,period,&b)||
       !r->query(r->db,Q_RECORDS,b.dataset,record,&b)) goto done;
    if(b.entity_count!=b.expected_entities||b.month_count!=b.expected_months||
       b.record_count!=b.expected_records||strcmp(b.first,b.first_seen)||strcmp(b.latest,b.last_seen)) goto done;
    if(!put(&b.meta,",\"sources\":[")||!bytes(&b.meta,b.sources.data,b.sources.length)||
       !put(&b.meta,"],\"row_counts_by_source\":{\"table3\":")||!integer_token(&b.meta,b.t3_count)||
       !number(&b.meta,"historical_before_2020",b.hist_count)||!put(&b.meta,"}}")) goto done;
    if(!put(&out,"{\"meta\":")||!bytes(&out,b.meta.data,b.meta.length)||
       !put(&out,",\"countries\":[")||!bytes(&out,b.countries.data,b.countries.length)||
       !put(&out,"],\"months\":[")||!bytes(&out,b.months.data,b.months.length)||
       !put(&out,"],\"records\":[")||!bytes(&out,b.records.data,b.records.length)||!put(&out,"]}")) goto done;
    *body=out.data;*length=out.length;out.data=NULL;ok=1;
done:
    free(out.data);free(b.meta.data);free(b.sources.data);free(b.countries.data);
    free(b.months.data);free(b.records.data);
    if(!ok&&error&&cap) snprintf(error,cap,"UST_DATA_UNAVAILABLE");
    return ok;
}
void ust_v2_free(char *body) { free(body); }
