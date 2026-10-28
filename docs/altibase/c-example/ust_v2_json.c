/* Reference implementation, C99 + company-approved cJSON.
 * No Python/Node/Java runtime is required by this server example.
 * Altibase driver, UTF-8 conversion and HTTP integration are in the adapter.
 */
#include "ust_v2_json.h"
#include "cJSON.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    cJSON *root, *meta, *countries, *months, *records, *sources;
    char dataset[37];
    int seen, entity_count, month_count, record_count;
    int t3_count, hist_count;
} Build;

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

/* add/append take ownership of value on BOTH success and failure. */
static int add(cJSON *parent, const char *key, cJSON *value) {
    if (!value) return 0;
    if (cJSON_AddItemToObject(parent,key,value)) return 1;
    cJSON_Delete(value); return 0;
}
static int append(cJSON *parent, cJSON *value) {
    if (!value) return 0;
    if (cJSON_AddItemToArray(parent,value)) return 1;
    cJSON_Delete(value); return 0;
}
static int text(cJSON *parent, const char *key, const char *value) {
    return value && add(parent,key,cJSON_CreateString(value));
}
static int number(cJSON *parent,const char *key,int value) {
    return add(parent,key,cJSON_CreateNumber(value));
}
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

/* Emit only validated JSON numeric tokens, never raw DB strings.
 * NUMERIC(20,3) is read as ASCII to avoid a float conversion in the C layer.
 * Reject exponent/locale commas/leading zeros/overprecision and values whose
 * magnitude in thousandths exceeds JavaScript's safe-integer range.
 * SQL NULL becomes JSON null; zero stays zero; negative flows are supported.
 */
static cJSON *decimal(const char *input) {
    char token[64]; const char *p; size_t n; int frac=0;
    uint64_t whole=0, tail=0, scaled;
    const uint64_t limit=UINT64_C(9007199254740991);
    if(!input) return cJSON_CreateNull();
    while(*input==' ') input++;
    n=strlen(input); while(n && input[n-1]==' ') n--;
    if(!n || n>=sizeof(token)) return NULL;
    memcpy(token,input,n); token[n]='\0'; p=token;
    if(*p=='-') p++;
    if(*p<'0'||*p>'9' || (*p=='0' && p[1]>='0'&&p[1]<='9')) return NULL;
    while(*p>='0'&&*p<='9') {
        unsigned d=(unsigned)(*p++-'0');
        if(whole>(limit-d)/10) return NULL;
        whole=whole*10+d;
    }
    if(*p=='.') {
        p++;
        while(*p>='0'&&*p<='9') {
            if(++frac>3) return NULL;
            tail=tail*10+(unsigned)(*p++-'0');
        }
        if(!frac) return NULL;
    }
    if(*p || whole>limit/1000) return NULL;
    while(frac++<3) tail*=10;
    scaled=whole*1000+tail;
    if(scaled>limit) return NULL;
    return cJSON_CreateRaw(token);
}
static int current(void *user,int n,const char *const *v) {
    Build *b=user;
    if(n!=1 || b->seen++ || !v[0] || strlen(v[0])!=36) return 0;
    memcpy(b->dataset,v[0],37); return 1;
}
static int metadata(void *user,int n,const char *const *v) {
    static const char *counts[]={"overlap_rows","overlap_differences",
        "cross_checks","historical_only_entities"};
    Build *b=user; int i,x;
    if(n!=13 || b->seen++ || !integer(v[0],&x) || x!=2 ||
       !month(v[1])||!month(v[2])||strcmp(v[1],v[2])>0 ||
       !month(v[4])||!month(v[5])) return 0;
    if(!number(b->meta,"schema_version",x)||
       !text(b->meta,"dataset_id",b->dataset)||
       !text(b->meta,"source_mode","altibase")||
       !text(b->meta,"first_month",v[1])||!text(b->meta,"latest_month",v[2])||
       !text(b->meta,"history_join",v[4])||!text(b->meta,"transaction_start",v[5])) return 0;
    if(v[3] && strcmp(v[3],"Y") && strcmp(v[3],"N")) return 0;
    if(!add(b->meta,"is_preliminary",v[3]?cJSON_CreateBool(!strcmp(v[3],"Y")):cJSON_CreateNull())) return 0;
    for(i=0;i<4;i++)
        if(!integer(v[i+6],&x)||!number(b->meta,counts[i],x)) return 0;
    return integer(v[10],&b->entity_count) && b->entity_count>0 &&
        integer(v[11],&b->month_count) && b->month_count>0 &&
        integer(v[12],&b->record_count) && b->record_count>0;
}
static int source(void *user,int n,const char *const *v) {
    static const char *codes[]={"T3","T5","HIST"};
    Build *b=user; cJSON *item; int pos=cJSON_GetArraySize(b->sources),i;
    if(n!=5 || pos>=3) return 0;
    for(i=0;i<5;i++) if(!v[i]) return 0;
    if(strcmp(v[4],codes[pos])||strlen(v[3])!=64) return 0;
    if(strlen(v[2])<20 || strlen(v[2])>30 || v[2][10]!='T'||v[2][strlen(v[2])-1]!='Z') return 0;
    item=cJSON_CreateObject(); if(!item) return 0;
    if(!text(item,"file",v[0])||!text(item,"url",v[1])||
       !text(item,"downloaded_at",v[2])||!text(item,"sha256",v[3])) {
        cJSON_Delete(item); return 0;
    }
    if(pos==0 && !text(b->meta,"downloaded_at",v[2])) {cJSON_Delete(item);return 0;}
    return append(b->sources,item);
}
static int country(void *user,int n,const char *const *v) {
    Build *b=user; cJSON *item; int ranked;
    if(n!=5||!v[0]||!v[1]||!v[3]||!v[4]) return 0;
    if(strcmp(v[3],"country")&&strcmp(v[3],"region")&&
       strcmp(v[3],"institution")&&strcmp(v[3],"total")) return 0;
    ranked=!strcmp(v[4],"Y");
    if((!ranked && strcmp(v[4],"N")) || ranked!=(!strcmp(v[3],"country"))) return 0;
    item=cJSON_CreateObject(); if(!item) return 0;
    if(!text(item,"country_name",v[0])||!text(item,"country_code",v[1])||
       !add(item,"region",v[2]?cJSON_CreateString(v[2]):cJSON_CreateNull())||
       !text(item,"record_type",v[3])||!add(item,"rank_eligible",cJSON_CreateBool(ranked))) {
        cJSON_Delete(item); return 0;
    }
    return append(b->countries,item);
}
static int period(void *user,int n,const char *const *v) {
    Build *b=user;
    return n==1 && month(v[0]) && append(b->months,cJSON_CreateString(v[0]));
}
static int record(void *user,int n,const char *const *v) {
    Build *b=user; cJSON *item; int i,src;
    if(n!=10||!v[0]||!month(v[1])||!v[9]) return 0;
    if(!strcmp(v[9],"T3")) src=0;
    else if(!strcmp(v[9],"HIST")) src=1;
    else return 0;
    item=cJSON_CreateArray(); if(!item) return 0;
    if(!append(item,cJSON_CreateString(v[0]))||!append(item,cJSON_CreateString(v[1]))) goto fail;
    for(i=2;i<9;i++) if(!append(item,decimal(v[i]))) goto fail;
    if(!append(item,cJSON_CreateNumber(src))) goto fail;
    if(!append(b->records,item)) return 0;
    if(src==0) b->t3_count++; else b->hist_count++;
    return 1;
fail:
    cJSON_Delete(item); return 0;
}
static int constant(cJSON *meta,const char *key,const char *json) {
    return add(meta,key,cJSON_Parse(json));
}
static int rules(cJSON *meta) {
    return text(meta,"base_unit","USD million") && text(meta,"table5_unit","USD billion") &&
      text(meta,"ranking_record_type","country") &&
      text(meta,"status","검증 완료 수집본 · 수정 가능 · 잠정 여부 미표기") &&
      constant(meta,"comparison_lags_months","[1,3,6,12]") &&
      constant(meta,"source_fields","[\"for_treas_pos\",\"for_lt_treas_pos\",\"for_st_treas_pos\",\"for_treas_net\",\"for_lt_treas_net\",\"for_st_treas_net\",\"for_lt_treas_valchg\"]") &&
      constant(meta,"record_columns","[\"country_code\",\"reference_month\",\"for_treas_pos\",\"for_lt_treas_pos\",\"for_st_treas_pos\",\"for_treas_net\",\"for_lt_treas_net\",\"for_st_treas_net\",\"for_lt_treas_valchg\",\"source_index\"]") &&
      constant(meta,"derived_fields",
       "{\"change\":\"current total holdings - exact lag-month total holdings\","
       "\"change_pct\":\"change / exact lag-month total holdings * 100\","
       "\"share_of_grand_total_pct\":\"entity total holdings / Grand Total * 100\","
       "\"long_term_share_pct\":\"long-term holdings / total holdings * 100\","
       "\"short_term_share_pct\":\"short-term holdings / total holdings * 100\","
       "\"rank\":\"descending total holdings among record_type=country only\","
       "\"other_adjustment_usd_mn\":\"monthly change - net transactions - long-term valuation change\","
       "\"null_rule\":\"missing comparison month, missing operand, or zero denominator => null\"}");
}
int ust_v2_build(const UstReader *r,char **body,size_t *length,char *error,size_t cap) {
    Build b; cJSON *counts; int ok=0;
    if(!body||!length) return 0;
    *body=NULL; *length=0; memset(&b,0,sizeof(b));
    if(error && cap) error[0]='\0';
    if(!r||!r->query) goto done;
    /* Pin current dataset ONCE; all subsequent SELECTs bind this value. */
    if(!r->query(r->db,Q_CURRENT,NULL,current,&b)||b.seen!=1) goto done;
    b.root=cJSON_CreateObject(); if(!b.root) goto done;
    b.meta=cJSON_AddObjectToObject(b.root,"meta");
    b.countries=cJSON_AddArrayToObject(b.root,"countries");
    b.months=cJSON_AddArrayToObject(b.root,"months");
    b.records=cJSON_AddArrayToObject(b.root,"records");
    if(!b.meta||!b.countries||!b.months||!b.records) goto done;
    b.sources=cJSON_AddArrayToObject(b.meta,"sources"); if(!b.sources) goto done;
    b.seen=0;
    if(!r->query(r->db,Q_META,b.dataset,metadata,&b)||b.seen!=1||!rules(b.meta)||
       !r->query(r->db,Q_SOURCES,b.dataset,source,&b)||cJSON_GetArraySize(b.sources)!=3||
       !r->query(r->db,Q_COUNTRIES,b.dataset,country,&b)||
       !r->query(r->db,Q_MONTHS,b.dataset,period,&b)||
       !r->query(r->db,Q_RECORDS,b.dataset,record,&b)) goto done;
    if(cJSON_GetArraySize(b.countries)!=b.entity_count||
       cJSON_GetArraySize(b.months)!=b.month_count||
       cJSON_GetArraySize(b.records)!=b.record_count) goto done;
    if(strcmp(cJSON_GetArrayItem(b.months,0)->valuestring,
              cJSON_GetObjectItemCaseSensitive(b.meta,"first_month")->valuestring)||
       strcmp(cJSON_GetArrayItem(b.months,b.month_count-1)->valuestring,
              cJSON_GetObjectItemCaseSensitive(b.meta,"latest_month")->valuestring)) goto done;
    counts=cJSON_AddObjectToObject(b.meta,"row_counts_by_source");
    if(!counts||!number(counts,"table3",b.t3_count)||
       !number(counts,"historical_before_2020",b.hist_count)) goto done;
    *body=cJSON_PrintUnformatted(b.root);
    if(!*body) goto done;
    *length=strlen(*body); ok=1;
done:
    cJSON_Delete(b.root);
    if(!ok && error && cap) snprintf(error,cap,"UST_DATA_UNAVAILABLE");
    return ok;
}
void ust_v2_free(char *body) { cJSON_free(body); }
