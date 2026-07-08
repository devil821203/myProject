package leetcode;
public class LongestPalindromicSubstring {

    // public static void main(String[] args) {

    //     long time1 = System.currentTimeMillis();
    //     System.out.println(longestPalindrome("asdasdaaf"));
    //     long time2 = System.currentTimeMillis();
    //     System.out.println(time2 - time1);
    // }

    public  String longestPalindrome(String s) {

        char[] chars = s.toCharArray();
        char[] reverseChars = new char[s.length()];
        for (int i = 0; i < chars.length; i++) {
            reverseChars[chars.length - 1 - i] = chars[i];
        }

        for (int i = s.length(); i > 0; i--) {
            for (int j = 0; i + j < s.length() + 1; j++) {

                if (isPalindromic(s.substring(j, j + i))) {
                    return s.substring(j, j + i);
                }
            }
        }

        return "";

    }

    public  boolean isPalindromic(String s) {

        for (int i = 0; i < s.length(); i++) {
            if (!(s.charAt(i) == s.charAt(s.length() - 1 - i))) {
                return false;
            }
        }
        return true;

    }
}
