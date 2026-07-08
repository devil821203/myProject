
package leetcode;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class StringToIntegeratoi {


    public StringToIntegeratoi() {
    }
    public  int myAtoi(String s) {
        Integer result=0;
        //清除前置空白
        String strTrim =s.trim();
        boolean ispositive=true;
        String validNumber="";
        for(int i=0 ;i<strTrim.length();i++){   
            if(i==0&&!strTrim.substring(0, 1).matches("[^0-9+-]")){
                validNumber=validNumber+strTrim.substring(0, 1);
                
            } else if(!strTrim.substring(i, i+1).matches("[^0-9]")){
                validNumber=validNumber+strTrim.substring(i, i+1);
            }else{
                break;
            }
        }
        if(validNumber.isEmpty()){
            return result;
        }

        if(validNumber.length()==1&&(validNumber.equals("+")||validNumber.equals("-"))){

            return result;
        }

        switch (validNumber.substring(0,1)) {
            case "-":
                ispositive=false;
                validNumber=validNumber.substring(1);
                 break;
            case "+":
                validNumber=validNumber.substring(1);
                break;            

        }

        Pattern p = Pattern.compile("[^0-9]");
        Matcher m = p.matcher(validNumber);
        if(m.find()){
            return result;
        }
        

        try{
            result=Integer.parseInt(validNumber.toString());
            if(!ispositive){
                result= -result; 
            }
        }catch(java.lang.NumberFormatException e){
            if(ispositive){
                return Integer.MAX_VALUE;

            }else{
                return Integer.MIN_VALUE;
            }
        }     

        return result;        
    }
    
}
