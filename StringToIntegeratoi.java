
public class StringToIntegeratoi {


    public static void main (String[] args){

        long time1=System.currentTimeMillis();
        System.out.println(StringToIntegeratoi("-42"));
        long time2=System.currentTimeMillis();
        System.out.println(time2-time1);
    }
    public static int myAtoi(String s) {
        int result=0;
        //清除前置空白
        String strTrim =s.trim();
        //先檢查開頭的符號

        boolean positive=true;
        if(strTrim.startsWith("[^0-9+-]")){
            if(strTrim.startsWith("-")){
                positive=false;
            }
        }else{
            return result;
        }

        return result;
        
    }
    
}
