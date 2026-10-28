/* Standard-C fixture adapter; no third-party source or JSON parser.
 * Input format: USTFIX1 newline, six groups in query order. Per group:
 * rows newline columns newline; per cell: length newline bytes newline.
 * -1 newline represents SQL NULL. A developer-side verifier prepares fixtures.
 */
#include "ust_v2_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {int rows,cols;char ***cells;} Group;
typedef struct {Group groups[6];const char *mutation;int queries;} Fixture;
static const char dataset[]="00000000-0000-4000-8000-000000000001";
static int query(void *db,const char *sql,const char *id,UstRow emit,void *user) {
    static const char *labels[]={"q_current","q_meta","q_sources","q_countries","q_months","q_records"};
    Fixture *f=db;Group *a;const char *v[16];int g,i,j;
    f->queries++;
    for(g=0;g<6;g++) if(strstr(sql,labels[g])) break;
    if(g==6) return 0;
    if(g==0) {if(id) return 0;if(!strcmp(f->mutation,"no-current")) return 1;}
    else {if(!id||strcmp(id,dataset)||!strcmp(f->mutation,"query-error")) return 0;}
    a=&f->groups[g];
    for(i=0;i<a->rows;i++) {
        for(j=0;j<a->cols;j++) v[j]=a->cells[i][j];
        if(g==1&&!strcmp(f->mutation,"bad-count")) v[12]="1";
        if(g==2&&i==2&&!strcmp(f->mutation,"bad-source")) v[4]="T5";
        if(g==4&&i==1&&!strcmp(f->mutation,"bad-month-order")) v[0]=a->cells[0][0];
        if(g==3&&i==0&&!strcmp(f->mutation,"invalid-utf8")) v[0]="\xc0\xaf";
        if(g==5&&i==0) {
            if(!strcmp(f->mutation,"bad-number")) v[2]="0],\"injected\":true";
            if(!strcmp(f->mutation,"large-number")) v[2]="9007199254740991";
            if(!strcmp(f->mutation,"comma-number")) v[2]="2,700";
            if(!strcmp(f->mutation,"leading-zero")) v[2]="02700";
            if(!strcmp(f->mutation,"too-precise")) v[2]="1.0001";
            if(!strcmp(f->mutation,"empty-number")) v[2]="";
            if(!strcmp(f->mutation,"nan-number")) v[2]="NaN";
            if(!strcmp(f->mutation,"exponent-number")) v[2]="1e3";
        }
        if(!emit(user,a->cols,v)) return 0;
    }
    return 1;
}
static void cleanup(Fixture *f) {
    int g,i,j;
    for(g=0;g<6;g++) {
        Group *a=&f->groups[g];
        for(i=0;i<a->rows&&a->cells;i++) {
            if(a->cells[i]) for(j=0;j<a->cols;j++) free(a->cells[i][j]);
            free(a->cells[i]);
        }
        free(a->cells);
    }
}
static int load(FILE *file,Fixture *f) {
    char magic[16];int g,i,j,n;
    if(!fgets(magic,sizeof(magic),file)||strcmp(magic,"USTFIX1\n")) return 0;
    for(g=0;g<6;g++) {
        Group *a=&f->groups[g];
        if(fscanf(file,"%d\n%d",&a->rows,&a->cols)!=2||fgetc(file)!='\n'||
           a->rows<0||a->rows>1000000||a->cols<1||a->cols>16) return 0;
        a->cells=calloc((size_t)a->rows,sizeof(*a->cells));
        if(a->rows&&!a->cells) return 0;
        for(i=0;i<a->rows;i++) {
            a->cells[i]=calloc((size_t)a->cols,sizeof(*a->cells[i]));if(!a->cells[i]) return 0;
            for(j=0;j<a->cols;j++) {
                char *s;
                if(fscanf(file,"%d",&n)!=1||fgetc(file)!='\n'||n< -1||n>16384) return 0;
                if(n== -1) continue;
                s=malloc((size_t)n+1);if(!s) return 0;a->cells[i][j]=s;
                if(fread(s,1,(size_t)n,file)!=(size_t)n||fgetc(file)!='\n') return 0;
                s[n]='\0';if(memchr(s,0,(size_t)n)) return 0;
            }
        }
    }
    return fgetc(file)==EOF;
}
int main(int argc,char **argv) {
    FILE *file;Fixture f;UstReader reader;int ok,result=1;
    char *body=NULL,error[64];size_t length=0;
    if(argc<2) return 2;
    memset(&f,0,sizeof(f));file=fopen(argv[1],"rb");if(!file) return 2;
    ok=load(file,&f);fclose(file);if(!ok) {cleanup(&f);return 2;}
    f.mutation=argc>2?argv[2]:"";reader.db=&f;reader.query=query;
#ifdef UST_JSON_TESTING
    if(!strcmp(f.mutation,"allocation-error")) ust_v2_test_fail_after(0);
    if(!strcmp(f.mutation,"growth-error")) ust_v2_test_fail_after(6);
#endif
    ok=ust_v2_build(&reader,&body,&length,error,sizeof(error));
    if(argc>2) {
        if(!ok&&!body&&!length&&error[0]) {
            fprintf(stderr,"PASS rejected %s without response body\n",f.mutation);result=0;
        }
    } else if(ok&&f.queries==6&&fwrite(body,1,length,stdout)==length) result=0;
    ust_v2_free(body);cleanup(&f);return result;
}
