/* Fixture-only test adapter. Does not connect to Altibase.
 * Build with ust_v2_json.c and approved cJSON; see the design's C appendix.
 * Usage: test_ust_v2_json fixture.json [mutation]
 * JSON goes to stdout on success; mutations must fail with no body emitted.
 */
#include "ust_v2_json.h"
#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

typedef struct { cJSON *data; const char *mutation; int queries; } Fixture;
static const char dataset[]="00000000-0000-4000-8000-000000000001";
static int allocations;
static void *fail_malloc(size_t size) {
    return allocations++>=50 ? NULL : malloc(size);
}
static const char *scalar(cJSON *x,char *buf) {
    if(cJSON_IsNull(x) || !x) return NULL;
    if(cJSON_IsString(x)) return x->valuestring;
    if(cJSON_IsBool(x)) return cJSON_IsTrue(x)?"Y":"N";
    snprintf(buf,64,"%.3f",x->valuedouble);
    /* Integer metadata must be an integer token, not a decimal token. */
    if(x->valuedouble>=INT_MIN && x->valuedouble<=INT_MAX &&
       x->valuedouble==(double)(int)x->valuedouble)
        snprintf(buf,64,"%d",(int)x->valuedouble);
    return buf;
}
static int query(void *db,const char *sql,const char *id,UstRow emit,void *user) {
    Fixture *f=db; cJSON *data=f->data,*meta=cJSON_GetObjectItem(data,"meta"),*a,*r;
    const char *v[16]; char nums[16][64]; int i,j,n;
    f->queries++;
    if(strstr(sql,"q_current")) {
        if(id) return 0;
        if(!strcmp(f->mutation,"no-current")) return 1;
        v[0]=dataset; return emit(user,1,v);
    }
    if(!id || strcmp(id,dataset)) return 0; /* Verify version pinned. */
    if(!strcmp(f->mutation,"query-error")) return 0;
    if(strstr(sql,"q_meta")) {
        static const char *keys[]={"schema_version","first_month","latest_month",
            "is_preliminary","history_join","transaction_start","overlap_rows",
            "overlap_differences","cross_checks","historical_only_entities"};
        for(i=0;i<10;i++) v[i]=scalar(cJSON_GetObjectItem(meta,keys[i]),nums[i]);
        for(i=10;i<13;i++) {
            const char *key=i==10?"countries":i==11?"months":"records";
            snprintf(nums[i],64,"%d",cJSON_GetArraySize(cJSON_GetObjectItem(data,key)));
            v[i]=nums[i];
        }
        if(!strcmp(f->mutation,"bad-count")) v[12]="1";
        return emit(user,13,v);
    }
    if(strstr(sql,"q_sources")) {
        static const char *codes[]={"T3","T5","HIST"};
        static const char *keys[]={"file","url","downloaded_at","sha256"};
        a=cJSON_GetObjectItem(meta,"sources");
        for(i=0;i<3;i++) {
            r=cJSON_GetArrayItem(a,i);
            for(j=0;j<4;j++) v[j]=cJSON_GetObjectItem(r,keys[j])->valuestring;
            v[4]=codes[i];
            if(!strcmp(f->mutation,"bad-source") && i==2) v[4]="T5";
            if(!emit(user,5,v)) return 0;
        }
        return 1;
    }
    if(strstr(sql,"q_countries")) {
        static const char *keys[]={"country_name","country_code","region","record_type","rank_eligible"};
        a=cJSON_GetObjectItem(data,"countries");
        cJSON_ArrayForEach(r,a) {
            for(j=0;j<5;j++) v[j]=scalar(cJSON_GetObjectItem(r,keys[j]),nums[j]);
            if(!emit(user,5,v)) return 0;
        }
        return 1;
    }
    if(strstr(sql,"q_months")) {
        a=cJSON_GetObjectItem(data,"months");
        cJSON_ArrayForEach(r,a) {v[0]=r->valuestring;if(!emit(user,1,v)) return 0;}
        return 1;
    }
    if(!strstr(sql,"q_records")) return 0;
    a=cJSON_GetObjectItem(data,"records"); n=cJSON_GetArraySize(a);
    for(i=0;i<n;i++) {
        r=cJSON_GetArrayItem(a,i);
        for(j=0;j<9;j++) v[j]=scalar(cJSON_GetArrayItem(r,j),nums[j]);
        v[9]=cJSON_GetArrayItem(r,9)->valueint==0?"T3":"HIST";
        if(i==0) {
            if(!strcmp(f->mutation,"bad-number")) v[2]="0],\"injected\":true";
            if(!strcmp(f->mutation,"large-number")) v[2]="9007199254740991";
            if(!strcmp(f->mutation,"comma-number")) v[2]="2,700";
            if(!strcmp(f->mutation,"leading-zero")) v[2]="02700";
            if(!strcmp(f->mutation,"too-precise")) v[2]="1.0001";
        }
        if(!emit(user,10,v)) return 0;
    }
    return 1;
}
int main(int argc,char **argv) {
    FILE *file; long n; char *input,*body=NULL,error[64]; size_t length=0;
    Fixture fixture; UstReader reader; int ok;
    if(argc<2) return 2;
    file=fopen(argv[1],"rb"); if(!file) return 2;
    fseek(file,0,SEEK_END);n=ftell(file);rewind(file);
    if(n<0) {fclose(file);return 2;}
    input=malloc((size_t)n+1); if(!input) {fclose(file);return 2;}
    if(fread(input,1,(size_t)n,file)!=(size_t)n) {fclose(file);free(input);return 2;}
    fclose(file); input[n]='\0'; fixture.data=cJSON_Parse(input);free(input);
    if(!fixture.data) return 2;
    fixture.mutation=argc>2?argv[2]:""; fixture.queries=0;
    reader.db=&fixture;reader.query=query;
    if(!strcmp(fixture.mutation,"allocation-error")) {
        cJSON_Hooks hooks; hooks.malloc_fn=fail_malloc;hooks.free_fn=free;
        allocations=0;cJSON_InitHooks(&hooks);
    }
    ok=ust_v2_build(&reader,&body,&length,error,sizeof(error));
    if(argc>2) {
        if(ok || body || length || !error[0]) {ust_v2_free(body);cJSON_Delete(fixture.data);return 1;}
        fprintf(stderr,"PASS rejected %s without response body\n",fixture.mutation);
    } else {
        cJSON *actual,*expected_meta,*actual_meta,*entry;
        if(!ok || fixture.queries!=6) {fprintf(stderr,"%s\n",error);cJSON_Delete(fixture.data);return 1;}
        actual=cJSON_Parse(body);
        if(!actual || !cJSON_Compare(cJSON_GetObjectItem(actual,"countries"),cJSON_GetObjectItem(fixture.data,"countries"),1)||
           !cJSON_Compare(cJSON_GetObjectItem(actual,"months"),cJSON_GetObjectItem(fixture.data,"months"),1)||
           !cJSON_Compare(cJSON_GetObjectItem(actual,"records"),cJSON_GetObjectItem(fixture.data,"records"),1)) {
            cJSON_Delete(actual);ust_v2_free(body);cJSON_Delete(fixture.data);return 1;
        }
        expected_meta=cJSON_GetObjectItem(fixture.data,"meta");actual_meta=cJSON_GetObjectItem(actual,"meta");
        cJSON_ArrayForEach(entry,expected_meta) {
            if(!strcmp(entry->string,"status")||!strcmp(entry->string,"source_mode")) continue;
            if(!cJSON_Compare(entry,cJSON_GetObjectItem(actual_meta,entry->string),1)) {
                fprintf(stderr,"Metadata mismatch: %s\n",entry->string);
                cJSON_Delete(actual);ust_v2_free(body);cJSON_Delete(fixture.data);return 1;
            }
        }
        cJSON_Delete(actual);
        if(fwrite(body,1,length,stdout)!=length) {ust_v2_free(body);cJSON_Delete(fixture.data);return 1;}
    }
    ust_v2_free(body);cJSON_Delete(fixture.data);return 0;
}
