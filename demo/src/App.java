import leetcode.RegularExpressionMatching;
import leetcode.StringToIntegeratoi;

public class App {
    public static void main(String[] args) throws Exception {
  
        String example="asqwertyujhgfvcxasdgtyuikhnmgfhrthsaegsgsef";
        // example.substring(0, 32);
        String result=(example.length()>32)?example.substring(0, 32):example;
        System.out.println(result);

        Long.valueOf();
        // String [][] example= {
        //     // {"",""},//true
        //     // {"aa","aaa"},//false
        //     // {"aa","aa"},//true
        //     // {"aaa","aa"},//false
        //     // {"abc","abc"},//true
        //     // {"abc","abcd"},//false
        //     // {"abcd","abc"},//false

        //     // {"","."},//false

        //     // {"abc",".."},//false
        //     // {"abba","a.a"},//false
        //     // {"aba","a.a"},//true

        //     // {"",".*"},//true
        //     // {"ab",".*"},//true
        //     // {"aa","a*"},//true
        //     // {"aab","a*b"},//true
        //     // {"aabbb","a*b*"},//true
        //     // {"abca","a*a"},//false
        //     // {"aab","c*a*b"},//true
        //     {"aaa","ab*a*c*a"},//true
            
        // };
        

        // for(int i=0;i<example.length;i++){
     
        //     long time1=System.currentTimeMillis();
        //     boolean result=new RegularExpressionMatching().isMatch(example[i][0],example[i][1]);
        //     long time2=System.currentTimeMillis();

        //     System.out.println(String.format("example %d_result:%s_costTime:%d", i,result,time2-time1));
        // }
    }
}
